from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pymupdf
from fastapi import APIRouter, Depends, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from app.api.deps import get_ingestion_manager, get_repo, get_request_locale, get_settings, get_vector_store
from app.core.config import Settings
from app.core.errors import BadRequestError, NotFoundError, PDFExtractionError
from app.core.i18n import Locale, t
from app.db.sqlite import ResearchRepository
from app.db.vector_store import VectorStore
from app.models.schemas import (
    DeletePaperResponse,
    IngestPathsRequest,
    IngestionJob,
    IngestionStatus,
    PaginatedResponse,
    Paper,
    PaperDetailResponse,
    PdfHighlightBox,
    PdfPageRenderResponse,
)
from app.pipeline.grounding import normalize_for_matching
from app.pipeline.worker import IngestionManager

router = APIRouter(tags=["papers"])


@router.post("/papers/ingest", response_model=list[IngestionJob], status_code=status.HTTP_202_ACCEPTED)
async def ingest_papers(
    request: Request,
    settings: Settings = Depends(get_settings),
    locale: Locale = Depends(get_request_locale),
    manager: IngestionManager = Depends(get_ingestion_manager),
) -> list[IngestionJob]:
    content_type = (request.headers.get("content-type") or "").lower()
    paths_to_process: list[Path] = []

    if "multipart/form-data" in content_type:
        form = await request.form()
        uploads = [v for v in form.getlist("files") if hasattr(v, "read")]
        if not uploads:
            raise BadRequestError(
                error_code="NO_FILES_PROVIDED",
                message="Yüklenecek PDF dosyası gönderilmedi ('files' alanı boş).",
            )
        settings.ensure_data_dirs()
        for item in uploads:
            upload: UploadFile = item  # type: ignore[assignment]
            raw_name = Path(upload.filename or "document.pdf").name
            if not raw_name.lower().endswith(".pdf"):
                raw_name = f"{raw_name}.pdf"
            upload_dir = settings.pdfs_dir / uuid.uuid4().hex[:8]
            upload_dir.mkdir(parents=True, exist_ok=True)
            dest = upload_dir / raw_name
            content = await upload.read()
            dest.write_bytes(content)
            paths_to_process.append(dest)
    else:
        try:
            body = await request.json()
            parsed = IngestPathsRequest.model_validate(body)
        except (ValueError, ValidationError) as exc:
            raise BadRequestError(
                error_code="INVALID_INGEST_REQUEST",
                message="Geçersiz ingestion isteği. 'file_paths' listesi veya multipart 'files' gönderilmelidir.",
                details={"error": str(exc)},
            ) from exc
        paths_to_process = [Path(p) for p in parsed.file_paths]

    jobs = [manager.enqueue_path(path, locale=locale) for path in paths_to_process]
    return jobs


@router.get("/jobs/{job_id}", response_model=IngestionJob)
def get_job(
    job_id: str,
    repo: ResearchRepository = Depends(get_repo),
) -> IngestionJob:
    return repo.get_job(job_id)


@router.get("/jobs/{job_id}/stream")
async def stream_job(
    job_id: str,
    manager: IngestionManager = Depends(get_ingestion_manager),
) -> StreamingResponse:
    return StreamingResponse(
        manager.subscribe(job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/papers", response_model=PaginatedResponse[Paper])
def list_papers(
    status_filter: IngestionStatus | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    repo: ResearchRepository = Depends(get_repo),
) -> PaginatedResponse[Paper]:
    items, total = repo.list_papers(status=status_filter, search=search, limit=limit, offset=offset)
    return PaginatedResponse[Paper](items=items, total=total, limit=limit, offset=offset)


@router.get("/papers/{paper_id}", response_model=PaperDetailResponse)
def get_paper_detail(
    paper_id: str,
    repo: ResearchRepository = Depends(get_repo),
) -> PaperDetailResponse:
    return repo.get_paper_detail(paper_id)


def _search_quote_boxes(page_obj: pymupdf.Page, quote: str) -> list[pymupdf.Rect]:
    """Find highlight rectangles on a PDF page for exact or wrapped quote phrases."""
    cleaned = " ".join(quote.split()).strip(" \"'`.,;:")
    if not cleaned:
        return []

    rects = page_obj.search_for(cleaned)
    if rects:
        return rects

    words = cleaned.split()
    if len(words) <= 5:
        return []

    matched: list[pymupdf.Rect] = []
    window = 5
    for idx in range(0, max(1, len(words) - window + 1), 3):
        phrase = " ".join(words[idx : idx + window])
        hits = page_obj.search_for(phrase)
        if hits:
            matched.extend(hits)
    return matched


@router.get("/papers/{paper_id}/file")
def get_paper_pdf_file(
    paper_id: str,
    locale: Locale = Depends(get_request_locale),
    repo: ResearchRepository = Depends(get_repo),
) -> FileResponse:
    paper = repo.get_paper(paper_id)
    pdf_path = Path(paper.file_path)
    if not pdf_path.exists() or not pdf_path.is_file():
        raise NotFoundError(
            error_code="PDF_FILE_MISSING",
            message=t(locale, "err.pdf_file_missing"),
            details={"paper_id": paper_id, "file_path": paper.file_path},
        )
    return FileResponse(path=pdf_path, media_type="application/pdf", filename=pdf_path.name)


@router.get("/papers/{paper_id}/page-render", response_model=PdfPageRenderResponse)
def render_paper_pdf_page(
    paper_id: str,
    page: int = Query(default=1, ge=1),
    quote: str | None = Query(default=None),
    zoom: float = Query(default=2.0, ge=0.75, le=3.5),
    locale: Locale = Depends(get_request_locale),
    repo: ResearchRepository = Depends(get_repo),
) -> PdfPageRenderResponse:
    paper = repo.get_paper(paper_id)
    pdf_path = Path(paper.file_path)
    if not pdf_path.exists() or not pdf_path.is_file():
        raise NotFoundError(
            error_code="PDF_FILE_MISSING",
            message=t(locale, "err.pdf_file_missing"),
            details={"paper_id": paper_id, "file_path": paper.file_path},
        )

    try:
        pdf_doc = pymupdf.open(str(pdf_path))
    except Exception as exc:
        raise PDFExtractionError(
            error_code="PDF_RENDER_FAILED",
            message=t(locale, "err.pdf_render_failed"),
            details={"paper_id": paper_id, "error": str(exc)},
        ) from exc

    try:
        total_pages = max(1, int(pdf_doc.page_count))
        if page < 1 or page > total_pages:
            raise BadRequestError(
                error_code="PDF_PAGE_OUT_OF_RANGE",
                message=t(locale, "err.pdf_page_out_of_range"),
                details={"paper_id": paper_id, "page_number": page, "page_count": total_pages},
            )

        page_obj = pdf_doc[page - 1]
        rect = page_obj.rect
        page_w = max(1.0, float(rect.width))
        page_h = max(1.0, float(rect.height))
        page_text = page_obj.get_text("text") or ""

        raw_rects = _search_quote_boxes(page_obj, quote) if quote else []
        highlights: list[PdfHighlightBox] = []
        for r in raw_rects[:24]:
            x = max(0.0, min(1.0, float(r.x0) / page_w))
            y = max(0.0, min(1.0, float(r.y0) / page_h))
            w = max(0.0, min(1.0 - x, float(r.x1 - r.x0) / page_w))
            h = max(0.0, min(1.0 - y, float(r.y1 - r.y0) / page_h))
            if w > 0.0 and h > 0.0:
                highlights.append(PdfHighlightBox(x=round(x, 5), y=round(y, 5), w=round(w, 5), h=round(h, 5)))

        match_found = bool(highlights)
        if not match_found and quote:
            nq = normalize_for_matching(quote)
            if nq and nq in normalize_for_matching(page_text):
                match_found = True

        pix = page_obj.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        png_b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
        data_url = f"data:image/png;base64,{png_b64}"

        return PdfPageRenderResponse(
            paper_id=paper.id,
            paper_title=paper.title,
            page_number=page,
            page_count=total_pages,
            width=page_w,
            height=page_h,
            image_data_url=data_url,
            page_text=page_text,
            quote_query=quote,
            match_found=match_found,
            highlights=highlights,
        )
    finally:
        pdf_doc.close()


@router.delete("/papers/{paper_id}", response_model=DeletePaperResponse)
def delete_paper(
    paper_id: str,
    repo: ResearchRepository = Depends(get_repo),
    vector_store: VectorStore = Depends(get_vector_store),
) -> DeletePaperResponse:
    repo.delete_paper(paper_id)
    vector_store.delete_paper_chunks(paper_id)
    return DeletePaperResponse(deleted=True, paper_id=paper_id)


@router.post("/papers/{paper_id}/reprocess", response_model=IngestionJob, status_code=status.HTTP_202_ACCEPTED)
def reprocess_paper(
    paper_id: str,
    locale: Locale = Depends(get_request_locale),
    repo: ResearchRepository = Depends(get_repo),
    manager: IngestionManager = Depends(get_ingestion_manager),
) -> IngestionJob:
    paper = repo.get_paper(paper_id)
    return manager.enqueue_path(Path(paper.file_path), reprocess_paper_id=paper.id, locale=locale)
