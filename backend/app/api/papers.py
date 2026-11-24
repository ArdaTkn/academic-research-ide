from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.api.deps import get_ingestion_manager, get_repo, get_request_locale, get_settings, get_vector_store
from app.core.config import Settings
from app.core.errors import BadRequestError
from app.core.i18n import Locale
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
)
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
