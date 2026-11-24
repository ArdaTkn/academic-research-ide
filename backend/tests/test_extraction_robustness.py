from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import ExtractionValidationError
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import JobStatus, ScaleMatrixFilter
from app.pipeline.llm_extractor import OpenAICompatibleLLMExtractor
from tests.conftest import StubLLMExtractor, build_sample_payload, make_blank_pdf, make_text_pdf, wait_for_job_sync


async def test_llm_extractor_rejects_out_of_bounds_page_and_invalid_alpha(tmp_path: Path) -> None:
    pdf_path = make_text_pdf(
        tmp_path / "two_pages.pdf",
        [
            "Page one introduction with sufficient text for extraction validation testing.",
            "Page two methods and results with Cronbach alpha 0.85 and N = 200 participants.",
        ],
    )
    from app.pipeline.pdf_extractor import extract_pdf

    doc = extract_pdf(pdf_path)

    # 1. Geçersiz alpha (> 1.0) ve 2. Sayfa sınırı dışı (page_number=9 > 2)
    bad_alpha_json = json.dumps(
        {
            "metadata": {"title": "Bad Alpha"},
            "sample_profile": {},
            "variables": [],
            "relationships": [],
            "scales": [{"name": "Scale A", "cronbach_alpha": 1.45, "page_number": 2}],
            "claims": [],
        }
    )
    bad_page_json = json.dumps(
        {
            "metadata": {"title": "Bad Page"},
            "sample_profile": {},
            "variables": [],
            "relationships": [],
            "scales": [],
            "claims": [{"claim_text": "Claim", "claim_type": "main_finding", "page_number": 9}],
        }
    )

    def _mock_response(content: str) -> MagicMock:
        msg = MagicMock()
        msg.content = content
        choice = MagicMock()
        choice.message = msg
        resp = MagicMock()
        resp.choices = [choice]
        return resp

    mock_client = MagicMock()
    mock_client.chat = MagicMock()
    mock_client.chat.completions = MagicMock()
    mock_client.chat.completions.create = AsyncMock(
        side_effect=[
            _mock_response(bad_alpha_json),
            _mock_response(bad_page_json),
            _mock_response("{not valid json"),
        ]
    )
    mock_client.close = AsyncMock()

    extractor = OpenAICompatibleLLMExtractor(
        base_url="http://127.0.0.1:11434/v1",
        model="stub-model",
        max_retries=2,
    )
    with patch("app.pipeline.llm_extractor.AsyncOpenAI", return_value=mock_client):
        with pytest.raises(ExtractionValidationError) as exc_info:
            await extractor.extract(doc)

    assert exc_info.value.error_code == "LLM_EXTRACTION_VALIDATION_FAILED"
    assert mock_client.chat.completions.create.await_count == 3


def test_failed_extraction_writes_zero_domain_rows_and_tracks_job_failure(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_path = make_text_pdf(
        tmp_path / "paper_bad_llm.pdf",
        ["Page 1 content is valid and long enough to pass PDF extraction checks cleanly."],
    )
    # LLM page_number=5 döndürsün (belge 1 sayfa olduğu için reddedilmeli)
    invalid_payload = build_sample_payload(page_number=5)
    stub_llm = StubLLMExtractor(payload=invalid_payload)

    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)
    with TestClient(app) as client:
        res = client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_path)]})
        assert res.status_code == 202
        job_id = res.json()[0]["id"]
        job = wait_for_job_sync(client, job_id)

        assert job["status"] == JobStatus.FAILED.value
        assert job["error_detail"] is not None
        assert "EXTRACTION_PAGE_OUT_OF_BOUNDS" in job["error_detail"]

        # DB'de hiçbir ilişki, ölçek veya iddia satırı yazılmamış olmalı
        matrix = app.state.repo.query_scale_matrix(ScaleMatrixFilter())
        assert matrix.total == 0
        graph = app.state.repo.build_graph()
        assert len(graph.nodes) == 0
        assert len(graph.edges) == 0


def test_partial_null_metrics_are_preserved_never_fabricated(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_path = make_text_pdf(
        tmp_path / "partial_metrics.pdf",
        [
            "Introduction: Studying autonomy and burnout in clinics.",
            "Method & Results: Autonomy negatively affected burnout. Scale had no reported alpha or N.",
        ],
    )
    payload = build_sample_payload(
        title="Autonomy and Burnout",
        alpha=None,
        sample_size=None,
        year=None,
        page_number=2,
    )
    stub_llm = StubLLMExtractor(payload=payload)
    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)

    with TestClient(app) as client:
        res = client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_path)]})
        assert res.status_code == 202
        job = wait_for_job_sync(client, res.json()[0]["id"])
        assert job["status"] == JobStatus.COMPLETED.value

        detail = client.get(f"/api/v1/papers/{job['paper_id']}").json()
        assert detail["paper"]["sample_size"] is None
        assert detail["paper"]["year"] is None
        assert detail["scales"][0]["cronbach_alpha"] is None


def test_scanned_pdf_and_duplicate_hash_fail_cleanly_via_job(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    scanned = make_blank_pdf(tmp_path / "scanned.pdf", num_pages=1)
    valid = make_text_pdf(
        tmp_path / "valid_dup.pdf",
        [
            "Page 1 valid academic study text on remote work and job performance.",
            "Page 2 empirical findings show significant positive relationship.",
        ],
    )
    copy_valid = tmp_path / "valid_dup_copy.pdf"
    copy_valid.write_bytes(valid.read_bytes())

    stub_llm = StubLLMExtractor(payload=build_sample_payload(page_number=2))
    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)

    with TestClient(app) as client:
        # 1. Taranmış PDF
        r1 = client.post("/api/v1/papers/ingest", json={"file_paths": [str(scanned)]})
        j1 = wait_for_job_sync(client, r1.json()[0]["id"])
        assert j1["status"] == JobStatus.FAILED.value
        assert "PDF_NO_TEXT_SCANNED" in (j1["error_detail"] or "")

        # 2. İlk yükleme başarılı
        r2 = client.post("/api/v1/papers/ingest", json={"file_paths": [str(valid)]})
        j2 = wait_for_job_sync(client, r2.json()[0]["id"])
        assert j2["status"] == JobStatus.COMPLETED.value

        # 3. Aynı SHA-256 tekrar yüklenince DUPLICATE_PAPER ile reddedilmeli
        r3 = client.post("/api/v1/papers/ingest", json={"file_paths": [str(copy_valid)]})
        j3 = wait_for_job_sync(client, r3.json()[0]["id"])
        assert j3["status"] == JobStatus.FAILED.value
        assert "DUPLICATE_PAPER" in (j3["error_detail"] or "")
