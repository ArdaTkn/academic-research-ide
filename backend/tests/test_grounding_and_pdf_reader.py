from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.sqlite import SQLiteDatabase
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import (
    ClaimType,
    ExtractedClaim,
    ExtractedMetadata,
    ExtractedRelationship,
    ExtractedSampleProfile,
    ExtractedScale,
    ExtractedVariable,
    GroundingStatus,
    PaperExtractionPayload,
    RelationshipDirection,
    VariableRole,
)
from app.pipeline.grounding import verify_quote_on_page
from tests.conftest import StubLLMExtractor, make_text_pdf, wait_for_job_sync


def test_verify_quote_on_page_outcomes() -> None:
    pages = {
        1: "Introduction. Self-efficacy improves workplace persistence across longitudinal cohorts.",
        2: "Results showed transformational leadership predicted engagement significantly (beta = 0.45, p < .001).",
    }

    exact = verify_quote_on_page(
        page_number=2,
        quote_snippet="transformational leadership predicted engagement significantly",
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert exact.status == GroundingStatus.VERIFIED
    assert exact.score == 1.0
    assert exact.note == "exact_quote_match"

    other_page = verify_quote_on_page(
        page_number=2,
        quote_snippet="Self-efficacy improves workplace persistence across longitudinal cohorts",
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert other_page.status == GroundingStatus.PARTIAL
    assert other_page.note == "quote_found_on_other_page:1"

    partial = verify_quote_on_page(
        page_number=2,
        quote_snippet="transformational leadership predicted engagement strongly under moderators",
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert partial.status in (GroundingStatus.VERIFIED, GroundingStatus.PARTIAL)
    assert partial.score >= 0.45

    unverified = verify_quote_on_page(
        page_number=2,
        quote_snippet="Neuroimaging spectroscopy demonstrated cortical gamma oscillation shift.",
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert unverified.status == GroundingStatus.UNVERIFIED
    assert unverified.note == "quote_not_found_on_page"

    out_of_range = verify_quote_on_page(
        page_number=99,
        quote_snippet="transformational leadership predicted engagement significantly",
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert out_of_range.status == GroundingStatus.UNVERIFIED
    assert out_of_range.note == "page_out_of_range"

    missing = verify_quote_on_page(
        page_number=2,
        quote_snippet=None,
        fallback_anchors=[],
        pages_by_num=pages,
    )
    assert missing.status == GroundingStatus.UNVERIFIED


def test_legacy_sqlite_migration_adds_grounding_columns(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE claims (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL,
            claim_text TEXT NOT NULL,
            claim_type TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            section_name TEXT,
            quote_snippet TEXT,
            confidence_score REAL NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE relationships (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL,
            source_variable_id TEXT NOT NULL,
            target_variable_id TEXT NOT NULL,
            direction TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            quote_snippet TEXT,
            confidence_score REAL NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE scales (
            id TEXT PRIMARY KEY,
            paper_id TEXT NOT NULL,
            variable_id TEXT,
            name TEXT NOT NULL,
            cronbach_alpha REAL,
            page_number INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.close()

    db = SQLiteDatabase(db_path)
    db.initialize()
    # Second initialize call must stay completely idempotent
    db.initialize()

    with db.connect() as verify_conn:
        for table in ("claims", "relationships", "scales"):
            cols = {
                row["name"]
                for row in verify_conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            assert {"grounding_status", "grounding_score", "grounding_note"} <= cols
        scale_cols = {
            row["name"]
            for row in verify_conn.execute("PRAGMA table_info(scales)").fetchall()
        }
        assert "quote_snippet" in scale_cols


def test_ingestion_grounding_matrix_filter_and_pdf_render_api(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_path = make_text_pdf(
        tmp_path / "leadership_engagement.pdf",
        [
            "Introduction.\nThis paper explores transformational leadership in engineering organizations.",
            (
                "Results:\n"
                "Transformational Leadership significantly predicted Employee Engagement.\n"
                "Path coefficient was significant.\n"
                "Utrecht Work Engagement Scale reliability alpha = 0.89."
            ),
        ],
    )

    payload = PaperExtractionPayload(
        metadata=ExtractedMetadata(
            title="Transformational Leadership and Engagement Study",
            authors=["Ada Lovelace"],
            year=2024,
            journal="Journal of Applied Psychology",
            language="en",
        ),
        sample_profile=ExtractedSampleProfile(
            sample_size=240,
            sample_population="Engineers",
            statistical_methods=["SEM"],
            research_design="Cross-sectional",
        ),
        variables=[
            ExtractedVariable(name="Transformational Leadership", role=VariableRole.INDEPENDENT, page_number=1),
            ExtractedVariable(name="Employee Engagement", role=VariableRole.DEPENDENT, page_number=2),
        ],
        relationships=[
            ExtractedRelationship(
                source_variable="Transformational Leadership",
                target_variable="Employee Engagement",
                direction=RelationshipDirection.POSITIVE,
                effect_size=0.45,
                effect_metric="beta",
                p_value="< 0.001",
                statistical_method="SEM",
                page_number=2,
                quote_snippet="Transformational Leadership significantly predicted Employee Engagement.",
                confidence_score=0.95,
            )
        ],
        scales=[
            ExtractedScale(
                variable_name="Employee Engagement",
                name="Utrecht Work Engagement Scale",
                item_count=9,
                cronbach_alpha=0.89,
                quote_snippet="Utrecht Work Engagement Scale reliability alpha = 0.89.",
                page_number=2,
            )
        ],
        claims=[
            ExtractedClaim(
                claim_text="Path coefficient was significant.",
                claim_type=ClaimType.MAIN_FINDING,
                page_number=2,
                section_name="Results",
                quote_snippet="Path coefficient was significant.",
                confidence_score=0.9,
            ),
            ExtractedClaim(
                claim_text="Unrelated fabricated secondary finding.",
                claim_type=ClaimType.LIMITATION,
                page_number=2,
                section_name="Discussion",
                quote_snippet="Quantum atmospheric coherence invalidated control responses completely.",
                confidence_score=0.4,
            ),
        ],
    )

    stub_llm = StubLLMExtractor(payload=payload)
    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)

    with TestClient(app) as client:
        res_ingest = client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_path)]})
        assert res_ingest.status_code == 202
        job = wait_for_job_sync(client, res_ingest.json()[0]["id"])
        assert job["status"] == "completed"
        paper_id = job["paper_id"]

        detail_res = client.get(f"/api/v1/papers/{paper_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()

        assert detail["scales"][0]["grounding_status"] == "verified"
        assert detail["relationships"][0]["grounding_status"] == "verified"
        claims_by_type = {c["claim_type"]: c for c in detail["claims"]}
        assert claims_by_type["main_finding"]["grounding_status"] == "verified"
        assert claims_by_type["limitation"]["grounding_status"] == "unverified"

        verified_matrix = client.get("/api/v1/matrix/scales", params={"grounding_status": "verified"}).json()
        assert verified_matrix["total"] == 1
        assert verified_matrix["items"][0]["grounding_status"] == "verified"

        unverified_matrix = client.get("/api/v1/matrix/scales", params={"grounding_status": "unverified"}).json()
        assert unverified_matrix["total"] == 0

        render_res = client.get(
            f"/api/v1/papers/{paper_id}/page-render",
            params={"page": 2, "quote": "Path coefficient was significant."},
        )
        assert render_res.status_code == 200
        render_data = render_res.json()
        assert render_data["page_number"] == 2
        assert render_data["page_count"] == 2
        assert render_data["image_data_url"].startswith("data:image/png;base64,")
        assert render_data["match_found"] is True
        assert len(render_data["highlights"]) >= 1
        box = render_data["highlights"][0]
        assert 0.0 <= box["x"] <= 1.0
        assert 0.0 <= box["y"] <= 1.0
        assert 0.0 < box["w"] <= 1.0
        assert 0.0 < box["h"] <= 1.0

        oor_res = client.get(
            f"/api/v1/papers/{paper_id}/page-render",
            params={"page": 9},
            headers={"X-Workspace-Locale": "tr"},
        )
        assert oor_res.status_code == 400
        assert oor_res.json()["error_code"] == "PDF_PAGE_OUT_OF_RANGE"

        # Remove original PDF file and assert graceful PDF_FILE_MISSING error
        pdf_path.unlink()
        missing_res = client.get(f"/api/v1/papers/{paper_id}/page-render", params={"page": 1})
        assert missing_res.status_code == 404
        assert missing_res.json()["error_code"] == "PDF_FILE_MISSING"

        file_res = client.get(f"/api/v1/papers/{paper_id}/file")
        assert file_res.status_code == 404
        assert file_res.json()["error_code"] == "PDF_FILE_MISSING"
