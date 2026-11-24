from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

from app.core.errors import AppError
from app.core.i18n import Locale, t
from app.db.sqlite import ResearchRepository, utc_now_iso
from app.db.vector_store import EmbeddingProvider, VectorStore
from app.models.schemas import IngestionJob, IngestionStatus, JobStatus
from app.pipeline.grounding import ground_extraction_payload
from app.pipeline.llm_extractor import LLMExtractor, validate_payload_against_document
from app.pipeline.pdf_extractor import chunk_document, extract_pdf


class IngestionManager:
    """Coordinates background PDF extraction, LLM parsing, SQLite persistence, and LanceDB indexing."""

    def __init__(
        self,
        *,
        repo: ResearchRepository,
        vector_store: VectorStore,
        llm_extractor: LLMExtractor,
        embedder: EmbeddingProvider,
        pdfs_dir: Path,
    ) -> None:
        self.repo = repo
        self.vector_store = vector_store
        self.llm_extractor = llm_extractor
        self.embedder = embedder
        self.pdfs_dir = pdfs_dir
        self._subscribers: dict[str, list[asyncio.Queue[IngestionJob | None]]] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def _emit(self, job: IngestionJob) -> None:
        queues = self._subscribers.get(job.id, [])
        for q in queues:
            q.put_nowait(job)
        if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
            for q in queues:
                q.put_nowait(None)

    async def subscribe(self, job_id: str) -> AsyncIterator[str]:
        job = self.repo.get_job(job_id)
        queue: asyncio.Queue[IngestionJob | None] = asyncio.Queue()
        self._subscribers.setdefault(job_id, []).append(queue)
        try:
            yield f"event: status\ndata: {job.model_dump_json()}\n\n"
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                return
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"event: status\ndata: {item.model_dump_json()}\n\n"
                if item.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                    break
        finally:
            subs = self._subscribers.get(job_id, [])
            if queue in subs:
                subs.remove(queue)
            if not subs and job_id in self._subscribers:
                self._subscribers.pop(job_id, None)

    def enqueue_path(
        self,
        file_path: Path,
        *,
        reprocess_paper_id: str | None = None,
        locale: Locale = "en",
    ) -> IngestionJob:
        job = self.repo.create_job(str(file_path), paper_id=reprocess_paper_id)
        task = asyncio.create_task(
            self.process_job(job.id, file_path, reprocess_paper_id=reprocess_paper_id, locale=locale)
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def process_job(
        self,
        job_id: str,
        file_path: Path,
        *,
        reprocess_paper_id: str | None = None,
        locale: Locale = "en",
    ) -> IngestionJob:
        paper_id: str | None = reprocess_paper_id
        try:
            job = self.repo.update_job(
                job_id,
                status=JobStatus.EXTRACTING_TEXT,
                progress_percent=15,
                current_stage_message=t(locale, "job.extracting_text"),
                started_at=utc_now_iso(),
            )
            self._emit(job)

            doc = await asyncio.to_thread(extract_pdf, file_path)

            if reprocess_paper_id is None:
                existing = self.repo.get_paper_by_hash(doc.file_hash_sha256)
                if existing is not None and existing.ingestion_status == IngestionStatus.COMPLETED:
                    raise AppError(
                        status_code=409,
                        error_code="DUPLICATE_PAPER",
                        message=t(locale, "err.duplicate_paper"),
                        details={"existing_paper_id": existing.id, "file_hash_sha256": doc.file_hash_sha256},
                    )
                if existing is not None and existing.ingestion_status in (
                    IngestionStatus.FAILED,
                    IngestionStatus.PENDING,
                    IngestionStatus.PARTIAL,
                ):
                    paper_id = existing.id

            paper = self.repo.create_or_reset_paper_stub(
                file_path=str(file_path),
                file_hash_sha256=doc.file_hash_sha256,
                page_count=doc.page_count,
                title_hint=file_path.stem,
                paper_id=paper_id,
            )
            paper_id = paper.id

            job = self.repo.update_job(
                job_id,
                paper_id=paper_id,
                status=JobStatus.PARSING_LLM,
                progress_percent=45,
                current_stage_message=t(locale, "job.parsing_llm"),
            )
            self._emit(job)

            payload = await self.llm_extractor.extract(doc)
            validate_payload_against_document(payload, doc.page_count)
            grounding = ground_extraction_payload(payload, doc)

            self.repo.persist_validated_extraction(
                paper_id=paper_id,
                payload=payload,
                grounding=grounding,
                status=IngestionStatus.PROCESSING,
            )

            job = self.repo.update_job(
                job_id,
                status=JobStatus.INDEXING_VECTORS,
                progress_percent=80,
                current_stage_message=t(locale, "job.indexing_vectors"),
            )
            self._emit(job)

            chunks = await asyncio.to_thread(chunk_document, paper_id, doc)
            if chunks:
                vectors = await asyncio.to_thread(self.embedder.embed_texts, [c.text for c in chunks])
                await asyncio.to_thread(self.vector_store.upsert_paper_chunks, paper_id, chunks, vectors)

            self.repo.mark_paper_completed(paper_id)
            job = self.repo.update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress_percent=100,
                current_stage_message=t(locale, "job.completed"),
                completed_at=utc_now_iso(),
            )
            self._emit(job)
            return job

        except Exception as exc:
            if isinstance(exc, AppError):
                err_payload = {"error_code": exc.error_code, "message": exc.message, "details": exc.details}
            else:
                err_payload = {
                    "error_code": "INGESTION_UNEXPECTED_ERROR",
                    "message": str(exc),
                    "details": {"exception_type": type(exc).__name__},
                }
            error_json = json.dumps(err_payload, ensure_ascii=False)
            if paper_id is not None:
                try:
                    self.repo.mark_paper_failed(paper_id, error_json)
                except Exception:
                    pass
            job = self.repo.update_job(
                job_id,
                paper_id=paper_id,
                status=JobStatus.FAILED,
                error_detail=error_json,
                current_stage_message=err_payload["message"],
                completed_at=utc_now_iso(),
            )
            self._emit(job)
            return job
