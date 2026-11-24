from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import (
    ExtractedClaim,
    ExtractedMetadata,
    ExtractedRelationship,
    ExtractedSampleProfile,
    ExtractedScale,
    ExtractedVariable,
    ClaimType,
    JobStatus,
    PaperExtractionPayload,
    RelationshipDirection,
    VariableRole,
)
from tests.conftest import StubLLMExtractor, make_text_pdf, wait_for_job_sync


def test_config_ui_locale_persistence_and_validation(
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    app = create_app(settings=temp_settings, llm_extractor=StubLLMExtractor(), embedder=local_embedder)
    with TestClient(app) as client:
        cfg = client.get("/api/v1/config")
        assert cfg.status_code == 200
        assert cfg.json()["ui_locale"] == "en"

        patched = client.patch("/api/v1/config", json={"ui_locale": "tr"})
        assert patched.status_code == 200
        assert patched.json()["ui_locale"] == "tr"

        invalid = client.patch("/api/v1/config", json={"ui_locale": "de"})
        assert invalid.status_code == 422

    # Reload from config.json on disk
    app2 = create_app(
        settings=Settings(data_dir=temp_settings.data_dir),
        llm_extractor=StubLLMExtractor(),
        embedder=local_embedder,
    )
    with TestClient(app2) as client2:
        cfg2 = client2.get("/api/v1/config")
        assert cfg2.status_code == 200
        assert cfg2.json()["ui_locale"] == "tr"


def test_accept_language_error_envelopes_and_localized_exports_and_audits(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_a = make_text_pdf(
        tmp_path / "study_a.pdf",
        [
            "Page 1: Investigating remote autonomy and burnout across software teams.",
            "Page 2: Results indicate remote autonomy negatively affects emotional exhaustion.",
        ],
    )
    payload_a = PaperExtractionPayload(
        metadata=ExtractedMetadata(
            title="Remote Autonomy and Exhaustion",
            authors=["Ada Lovelace"],
            year=2024,
            abstract="Remote autonomy lowers emotional exhaustion.",
        ),
        sample_profile=ExtractedSampleProfile(sample_size=280, statistical_methods=["SEM"]),
        variables=[
            ExtractedVariable(name="Remote Autonomy", role=VariableRole.INDEPENDENT, page_number=1),
            ExtractedVariable(name="Emotional Exhaustion", role=VariableRole.DEPENDENT, page_number=1),
            ExtractedVariable(name="Team Cohesion", role=VariableRole.MEDIATOR, page_number=1),
        ],
        scales=[
            ExtractedScale(
                name="Burnout Inventory",
                variable_name="Emotional Exhaustion",
                cronbach_alpha=0.88,
                item_count=5,
                page_number=2,
            )
        ],
        relationships=[
            ExtractedRelationship(
                source_variable="Remote Autonomy",
                target_variable="Emotional Exhaustion",
                direction=RelationshipDirection.NEGATIVE,
                effect_size=-0.34,
                effect_metric="beta",
                statistical_method="SEM",
                page_number=2,
                quote_snippet="Remote autonomy significantly lowered exhaustion.",
            ),
            ExtractedRelationship(
                source_variable="Team Cohesion",
                target_variable="Emotional Exhaustion",
                direction=RelationshipDirection.NEGATIVE,
                effect_size=-0.28,
                effect_metric="beta",
                statistical_method="SEM",
                page_number=2,
                quote_snippet="Team cohesion buffered exhaustion.",
            ),
        ],
        claims=[
            ExtractedClaim(
                claim_text="Remote autonomy lowers emotional exhaustion.",
                claim_type=ClaimType.MAIN_FINDING,
                page_number=2,
                quote_snippet="Beta = -0.34.",
            )
        ],
    )

    app = create_app(
        settings=temp_settings,
        llm_extractor=StubLLMExtractor(payload=payload_a),
        embedder=local_embedder,
    )
    with TestClient(app) as client:
        # Localized 404 error via Accept-Language
        err_en = client.get("/api/v1/papers/nonexistent", headers={"Accept-Language": "en"})
        assert err_en.status_code == 404
        assert err_en.json()["message"] == "Paper not found."

        err_tr = client.get("/api/v1/papers/nonexistent", headers={"Accept-Language": "tr"})
        assert err_tr.status_code == 404
        assert err_tr.json()["message"] == "Makale bulunamadı."

        # Ingest paper
        job = wait_for_job_sync(
            client,
            client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_a)]}).json()[0]["id"],
        )
        assert job["status"] == JobStatus.COMPLETED.value

        # Style profile summaries in EN vs TR
        sp_en = client.post(
            "/api/v1/style-profiles/extract",
            json={
                "name": "English Profile",
                "raw_texts": ["Evidence suggests autonomy may improve team clarity (Lovelace, 2024)."],
                "locale": "en",
            },
        )
        assert sp_en.status_code == 201
        assert "Avg. sentence length:" in sp_en.json()["system_prompt_summary"]

        sp_tr = client.post(
            "/api/v1/style-profiles/extract",
            json={
                "name": "Turkish Profile",
                "raw_texts": ["Bulgular otonominin ekip netliğini artırabileceğini göstermektedir (Lovelace, 2024)."],
                "locale": "tr",
            },
        )
        assert sp_tr.status_code == 201
        assert "Ort. cümle uzunluğu:" in sp_tr.json()["system_prompt_summary"]

        # Localized CSV headers
        csv_en = client.get("/api/v1/matrix/export?format=csv&locale=en")
        assert csv_en.status_code == 200
        assert csv_en.text.splitlines()[0].startswith("scale_id,paper_id,paper_title")

        csv_tr = client.get("/api/v1/matrix/export?format=csv&locale=tr")
        assert csv_tr.status_code == 200
        assert csv_tr.text.splitlines()[0].startswith("olcek_id,makale_id,makale_basligi")

        # Localized gap rationales
        gaps_en = client.get("/api/v1/graph/gaps?locale=en")
        gaps_tr = client.get("/api/v1/graph/gaps?locale=tr")
        assert gaps_en.status_code == 200 and gaps_tr.status_code == 200
        if gaps_en.json() and gaps_tr.json():
            assert "neighbor variable(s)" in gaps_en.json()[0]["rationale"]
            assert "ortak komşu değişken" in gaps_tr.json()[0]["rationale"]

        # Draft audits in EN vs TR: distinct cache entries, verbatim quotes, never fabricate citations
        draft_id = client.post("/api/v1/drafts", json={"title": "Bilingual Audit"}).json()["id"]
        para_contradict = "Remote autonomy increases emotional exhaustion across every distributed firm."
        audit_en = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={"paragraph_index": 0, "paragraph_text": para_contradict, "locale": "en"},
        ).json()
        audit_tr = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={"paragraph_index": 0, "paragraph_text": para_contradict, "locale": "tr"},
        ).json()

        assert audit_en["id"] != audit_tr["id"]
        assert "Audited 1 empirical" in audit_en["summary"]
        assert "1 ampirik" in audit_tr["summary"]

        c_en = next(f for f in audit_en["findings"] if f["finding_type"] == "contradiction")
        c_tr = next(f for f in audit_tr["findings"] if f["finding_type"] == "contradiction")
        # Verbatim PDF quote and original paper title are never translated
        assert c_en["quote_snippet"] == "Remote autonomy significantly lowered exhaustion."
        assert c_tr["quote_snippet"] == "Remote autonomy significantly lowered exhaustion."
        assert "Remote Autonomy and Exhaustion" in c_en["explanation"]
        assert "Remote Autonomy and Exhaustion" in c_tr["explanation"]

        # Unsupported claim in either language never invents a paper or page
        u_tr = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={
                "paragraph_index": 1,
                "paragraph_text": "Martian gravity increases coffee roast entropy across lunar cafés.",
                "locale": "tr",
            },
        ).json()
        assert u_tr["overall_status"] == "unsupported"
        uf = u_tr["findings"][0]
        assert uf["related_paper_id"] is None
        assert uf["page_number"] is None
        assert uf["quote_snippet"] is None
