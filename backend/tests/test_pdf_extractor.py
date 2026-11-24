from __future__ import annotations

from pathlib import Path

import pytest

from app.core.errors import NotFoundError, PDFExtractionError
from app.pipeline.pdf_extractor import chunk_document, extract_pdf
from tests.conftest import make_blank_pdf, make_text_pdf


def test_extract_valid_multipage_pdf_and_preserve_page_numbers(tmp_path: Path) -> None:
    pdf_path = make_text_pdf(
        tmp_path / "valid.pdf",
        [
            "Introduction\nThis paper investigates organizational trust and job satisfaction across 300 employees.",
            "Method\nWe administered a 7-item Likert scale with Cronbach alpha of 0.88 and used SEM.",
            "Results\nTrust positively predicted job satisfaction on page three with beta = 0.42.",
        ],
    )
    doc = extract_pdf(pdf_path)
    assert doc.page_count == 3
    assert len(doc.pages) == 3
    assert doc.pages[0].page_number == 1
    assert doc.pages[2].page_number == 3

    chunks = chunk_document("paper-1", doc, max_chars=80, overlap_chars=10)
    assert len(chunks) >= 3
    assert all(1 <= c.page_number <= 3 for c in chunks)
    assert any(c.page_number == 3 and "page three" in c.text for c in chunks)


def test_corrupted_pdf_raises_structured_error(tmp_path: Path) -> None:
    bad_pdf = tmp_path / "corrupt.pdf"
    bad_pdf.write_bytes(b"%PDF-1.4\nnot-a-valid-pdf-body-corrupted-stream")
    with pytest.raises(PDFExtractionError) as exc_info:
        extract_pdf(bad_pdf)
    assert exc_info.value.error_code == "PDF_CORRUPTED"


def test_empty_or_scanned_pdf_without_text_raises_error(tmp_path: Path) -> None:
    blank_pdf = make_blank_pdf(tmp_path / "scanned.pdf", num_pages=2)
    with pytest.raises(PDFExtractionError) as exc_info:
        extract_pdf(blank_pdf)
    assert exc_info.value.error_code == "PDF_NO_TEXT_SCANNED"


def test_missing_pdf_raises_not_found(tmp_path: Path) -> None:
    with pytest.raises(NotFoundError) as exc_info:
        extract_pdf(tmp_path / "does_not_exist.pdf")
    assert exc_info.value.error_code == "PDF_NOT_FOUND"
