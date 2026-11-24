from __future__ import annotations

from pathlib import Path
from typing import Any

import pymupdf
import pytest

from app.core.config import Settings
from app.db.vector_store import LocalHashEmbedder
from app.models.schemas import (
    ClaimType,
    ExtractedClaim,
    ExtractedMetadata,
    ExtractedRelationship,
    ExtractedSampleProfile,
    ExtractedScale,
    ExtractedVariable,
    PaperExtractionPayload,
    RelationshipDirection,
    VariableRole,
)
from app.pipeline.pdf_extractor import ExtractedDocument


def make_text_pdf(path: Path, pages_text: list[str]) -> Path:
    doc = pymupdf.open()
    for page_text in pages_text:
        page = doc.new_page()
        page.insert_text((72, 72), page_text)
    doc.save(str(path))
    doc.close()
    return path


def make_blank_pdf(path: Path, num_pages: int = 2) -> Path:
    doc = pymupdf.open()
    for _ in range(num_pages):
        doc.new_page()
    doc.save(str(path))
    doc.close()
    return path


class StubLLMExtractor:
    """Controllable LLM extractor stub for deterministic QA tests."""

    def __init__(self, payload: PaperExtractionPayload | None = None, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error
        self._by_filename: dict[str, PaperExtractionPayload] = {}

    def register(self, filename: str, payload: PaperExtractionPayload) -> None:
        self._by_filename[filename] = payload

    async def extract(self, doc: ExtractedDocument) -> PaperExtractionPayload:
        if self._error is not None:
            raise self._error
        if doc.file_path.name in self._by_filename:
            return self._by_filename[doc.file_path.name]
        if self._payload is not None:
            return self._payload
        return build_sample_payload(title=f"Sample Paper ({doc.file_path.name})")


def build_sample_payload(
    *,
    title: str = "Transformational Leadership and Employee Engagement",
    direction: RelationshipDirection = RelationshipDirection.POSITIVE,
    alpha: float | None = 0.89,
    sample_size: int | None = 312,
    year: int | None = 2024,
    page_number: int = 2,
    extra_vars: tuple[str, str] = ("Transformational Leadership", "Employee Engagement"),
) -> PaperExtractionPayload:
    return PaperExtractionPayload(
        metadata=ExtractedMetadata(
            title=title,
            authors=["Ada Lovelace", "Alan Turing"],
            year=year,
            journal="Journal of Applied Research",
            doi="10.1000/test.2024.001",
            abstract="Examines leadership effects on engagement.",
            language="en",
        ),
        sample_profile=ExtractedSampleProfile(
            sample_size=sample_size,
            sample_population="Software Engineers",
            sampling_method="Purposive",
            study_context="Tech industry",
            statistical_methods=["SEM", "CFA"],
            research_design="Cross-sectional",
        ),
        variables=[
            ExtractedVariable(name=extra_vars[0], role=VariableRole.INDEPENDENT, page_number=1),
            ExtractedVariable(name=extra_vars[1], role=VariableRole.DEPENDENT, page_number=1),
        ],
        relationships=[
            ExtractedRelationship(
                source_variable=extra_vars[0],
                target_variable=extra_vars[1],
                source_role=VariableRole.INDEPENDENT,
                target_role=VariableRole.DEPENDENT,
                direction=direction,
                effect_size=0.45 if direction == RelationshipDirection.POSITIVE else -0.32,
                effect_metric="beta",
                p_value="< 0.001",
                statistical_method="SEM",
                page_number=page_number,
                quote_snippet=f"{extra_vars[0]} significantly predicted {extra_vars[1]}.",
                confidence_score=0.92,
            )
        ],
        scales=[
            ExtractedScale(
                variable_name=extra_vars[1],
                name="Utrecht Work Engagement Scale",
                original_authors="Schaufeli et al.",
                original_year=2006,
                item_count=9,
                cronbach_alpha=alpha,
                composite_reliability=0.91,
                ave=0.62,
                response_format="7-point Likert",
                language="en",
                page_number=page_number,
            )
        ],
        claims=[
            ExtractedClaim(
                claim_text=f"{extra_vars[0]} shows a {direction.value} association with {extra_vars[1]}.",
                claim_type=ClaimType.MAIN_FINDING,
                page_number=page_number,
                section_name="Results",
                quote_snippet="Path coefficient was significant.",
                confidence_score=0.9,
            )
        ],
    )


@pytest.fixture()
def temp_settings(tmp_path: Path) -> Settings:
    settings = Settings(
        data_dir=tmp_path / "data",
        embedding_provider="local_hash",
        embedding_dim=384,
    )
    settings.ensure_data_dirs()
    return settings


@pytest.fixture()
def local_embedder() -> LocalHashEmbedder:
    return LocalHashEmbedder(dim=384)


def wait_for_job_sync(client: Any, job_id: str, timeout_iters: int = 50) -> dict[str, Any]:
    import time

    for _ in range(timeout_iters):
        res = client.get(f"/api/v1/jobs/{job_id}")
        assert res.status_code == 200
        data = res.json()
        if data["status"] in ("completed", "failed"):
            return data
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not finish in time")
