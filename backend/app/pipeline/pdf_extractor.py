from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

import pymupdf
import pdfplumber

from app.core.errors import NotFoundError, PDFExtractionError


@dataclass(slots=True)
class ExtractedPage:
    page_number: int
    text: str
    section_name: str
    has_tables: bool


@dataclass(slots=True)
class ExtractedDocument:
    file_path: Path
    file_hash_sha256: str
    page_count: int
    pages: list[ExtractedPage]

    def format_for_llm(self, max_chars: int = 120_000) -> str:
        """Render page-tagged document text so the LLM sees explicit [PAGE N] markers."""
        parts: list[str] = []
        total = 0
        for page in self.pages:
            block = f"[PAGE {page.page_number}]\n{page.text.strip()}\n"
            if total + len(block) > max_chars:
                remaining = max_chars - total
                if remaining > 100:
                    parts.append(block[:remaining])
                break
            parts.append(block)
            total += len(block)
        return "\n".join(parts)


@dataclass(slots=True)
class DocumentChunk:
    chunk_id: str
    paper_id: str
    page_number: int
    section_name: str
    chunk_index: int
    text: str


def compute_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def _detect_section_heading(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if 3 <= len(stripped) <= 80 and not stripped.endswith("."):
            lowered = stripped.lower()
            if any(
                kw in lowered
                for kw in (
                    "abstract",
                    "introduction",
                    "literature",
                    "method",
                    "sample",
                    "measure",
                    "scale",
                    "result",
                    "discussion",
                    "conclusion",
                    "limitation",
                )
            ):
                return stripped
    return ""


def _format_tables(tables: list[list[list[str | None]]]) -> str:
    rendered_tables: list[str] = []
    for table in tables:
        lines: list[str] = []
        for row in table:
            cells = [" ".join((cell or "").split()) for cell in row]
            if any(cells):
                lines.append(" | ".join(cells))
        if lines:
            rendered_tables.append("[TABLE]\n" + "\n".join(lines))
    return "\n\n".join(rendered_tables)


def extract_pdf(file_path: Path) -> ExtractedDocument:
    """Extract page-indexed text & tables from a local PDF with fail-closed checks."""
    if not file_path.exists() or not file_path.is_file():
        raise NotFoundError(
            error_code="PDF_NOT_FOUND",
            message="Belirtilen PDF dosyası bulunamadı.",
            details={"file_path": str(file_path)},
        )

    if file_path.stat().st_size == 0:
        raise PDFExtractionError(
            error_code="PDF_CORRUPTED",
            message="PDF dosyası boş (0 bayt).",
            details={"file_path": str(file_path)},
        )

    file_hash = compute_sha256(file_path)

    try:
        fitz_doc = pymupdf.open(str(file_path))
    except Exception as exc:
        raise PDFExtractionError(
            error_code="PDF_CORRUPTED",
            message="PDF dosyası bozuk veya geçerli bir PDF değil.",
            details={"file_path": str(file_path), "error": str(exc)},
        ) from exc

    try:
        if fitz_doc.is_encrypted:
            raise PDFExtractionError(
                error_code="PDF_ENCRYPTED",
                message="Şifreli PDF dosyası okunamıyor.",
                details={"file_path": str(file_path)},
            )

        page_count = fitz_doc.page_count
        if page_count < 1:
            raise PDFExtractionError(
                error_code="PDF_EMPTY_PAGES",
                message="PDF içinde hiç sayfa bulunamadı.",
                details={"file_path": str(file_path)},
            )

        fitz_texts: list[str] = []
        for idx in range(page_count):
            page = fitz_doc.load_page(idx)
            fitz_texts.append(page.get_text("text") or "")
    finally:
        fitz_doc.close()

    pages: list[ExtractedPage] = []
    try:
        with pdfplumber.open(str(file_path)) as plumber_doc:
            for idx in range(page_count):
                page_number = idx + 1
                primary_text = fitz_texts[idx].strip()
                has_tables = False
                table_block = ""

                if idx < len(plumber_doc.pages):
                    p_page = plumber_doc.pages[idx]
                    tables = p_page.extract_tables() or []
                    if tables:
                        has_tables = True
                        table_block = _format_tables(tables)
                    if len(primary_text) < 40:
                        fallback_text = (p_page.extract_text() or "").strip()
                        if len(fallback_text) > len(primary_text):
                            primary_text = fallback_text

                combined = primary_text
                if table_block:
                    combined = f"{primary_text}\n\n{table_block}".strip()

                pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        text=combined,
                        section_name=_detect_section_heading(combined),
                        has_tables=has_tables,
                    )
                )
    except PDFExtractionError:
        raise
    except Exception:
        # pdfplumber tablo okumasında hata verirse PyMuPDF metniyle devam et (boşsa aşağıda yakalanır)
        pages = [
            ExtractedPage(
                page_number=idx + 1,
                text=txt.strip(),
                section_name=_detect_section_heading(txt),
                has_tables=False,
            )
            for idx, txt in enumerate(fitz_texts)
        ]

    non_ws_chars = sum(len("".join(p.text.split())) for p in pages)
    if non_ws_chars < 50:
        raise PDFExtractionError(
            error_code="PDF_NO_TEXT_SCANNED",
            message="PDF içinde çıkarılabilir metin bulunamadı (taranmış görüntü veya boş belge olabilir).",
            details={"file_path": str(file_path), "page_count": page_count, "extracted_chars": non_ws_chars},
        )

    return ExtractedDocument(
        file_path=file_path,
        file_hash_sha256=file_hash,
        page_count=page_count,
        pages=pages,
    )


def chunk_document(
    paper_id: str,
    doc: ExtractedDocument,
    *,
    max_chars: int = 1200,
    overlap_chars: int = 150,
) -> list[DocumentChunk]:
    """Chunk text strictly within page boundaries so `page_number` stays exact (>= 1)."""
    chunks: list[DocumentChunk] = []
    chunk_index = 0
    step = max(1, max_chars - overlap_chars)

    for page in doc.pages:
        cleaned = " ".join(page.text.split())
        if not cleaned:
            continue
        start = 0
        while start < len(cleaned):
            piece = cleaned[start : start + max_chars].strip()
            if piece:
                chunks.append(
                    DocumentChunk(
                        chunk_id=str(uuid.uuid4()),
                        paper_id=paper_id,
                        page_number=page.page_number,
                        section_name=page.section_name,
                        chunk_index=chunk_index,
                        text=piece,
                    )
                )
                chunk_index += 1
            if start + max_chars >= len(cleaned):
                break
            start += step

    return chunks
