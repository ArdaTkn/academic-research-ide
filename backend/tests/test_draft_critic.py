from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import (
    ClaimType,
    ExtractedClaim,
    ExtractedMetadata,
    ExtractedRelationship,
    ExtractedSampleProfile,
    ExtractedVariable,
    JobStatus,
    PaperExtractionPayload,
    RelationshipDirection,
    VariableRole,
)
from tests.conftest import StubLLMExtractor, make_text_pdf, wait_for_job_sync


def test_style_extraction_activation_and_lancedb_indexing(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    past_md = tmp_path / "past_article.md"
    past_md.write_text(
        (
            "Prior empirical evidence suggests that remote autonomy may enhance job satisfaction (Lovelace, 2023). "
            "However, organizational trust appears to moderate this linkage in distributed teams. "
            "Moreover, survey scales were administered across two waves."
        ),
        encoding="utf-8",
    )

    app = create_app(settings=temp_settings, llm_extractor=StubLLMExtractor(), embedder=local_embedder)
    with TestClient(app) as client:
        res1 = client.post(
            "/api/v1/style-profiles/extract",
            json={
                "name": "Q1 Academic Style",
                "file_paths": [str(past_md)],
                "raw_texts": ["Consequently, these findings indicate a nuanced boundary condition."],
                "set_active": True,
            },
        )
        assert res1.status_code == 201
        p1 = res1.json()
        assert p1["is_active"] is True
        assert p1["avg_sentence_length"] > 5.0
        assert "suggests" in p1["hedging_phrases"]
        assert "however" in p1["transition_phrases"]
        assert p1["citation_style"] == "APA 7"

        # LanceDB style_chunks indekslenmiş olmalı
        hits = app.state.vector_store.search_style_chunks(
            local_embedder.embed_texts(["remote autonomy job satisfaction"])[0],
            style_profile_id=p1["id"],
            limit=3,
        )
        assert len(hits) >= 1

        # İkinci profil oluşturup ilkini yeniden aktifleştirme
        res2 = client.post(
            "/api/v1/style-profiles/extract",
            json={"name": "Short Notes", "raw_texts": ["We tested this directly in two firms."], "set_active": True},
        )
        assert res2.status_code == 201
        p2 = res2.json()
        assert p2["is_active"] is True

        reactivated = client.patch(f"/api/v1/style-profiles/{p1['id']}/activate")
        assert reactivated.status_code == 200
        assert reactivated.json()["is_active"] is True

        all_profiles = client.get("/api/v1/style-profiles").json()
        active_ids = [p["id"] for p in all_profiles if p["is_active"]]
        assert active_ids == [p1["id"]]


def test_critic_contradiction_support_missing_citation_and_no_fabricated_sources(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_a = make_text_pdf(
        tmp_path / "evidence.pdf",
        [
            "Page 1: Investigating remote work autonomy and employee engagement across software teams.",
            "Page 2: Structural equation modeling shows remote autonomy positively increases employee engagement.",
        ],
    )
    payload = PaperExtractionPayload(
        metadata=ExtractedMetadata(
            title="Remote Autonomy and Engagement",
            authors=["Ada Lovelace"],
            year=2024,
            abstract="Remote autonomy increases employee engagement.",
        ),
        sample_profile=ExtractedSampleProfile(sample_size=320, statistical_methods=["SEM"]),
        variables=[
            ExtractedVariable(name="Remote Autonomy", role=VariableRole.INDEPENDENT, page_number=1),
            ExtractedVariable(name="Employee Engagement", role=VariableRole.DEPENDENT, page_number=1),
        ],
        relationships=[
            ExtractedRelationship(
                source_variable="Remote Autonomy",
                target_variable="Employee Engagement",
                direction=RelationshipDirection.POSITIVE,
                effect_size=0.46,
                effect_metric="beta",
                p_value="< 0.001",
                statistical_method="SEM",
                page_number=2,
                quote_snippet="Remote autonomy significantly increased employee engagement.",
            )
        ],
        claims=[
            ExtractedClaim(
                claim_text="Remote autonomy positively predicts employee engagement in distributed teams.",
                claim_type=ClaimType.MAIN_FINDING,
                page_number=2,
                section_name="Results",
                quote_snippet="Beta = 0.46, p < 0.001.",
            )
        ],
    )

    stub_llm = StubLLMExtractor(payload=payload)
    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)

    with TestClient(app) as client:
        job = wait_for_job_sync(
            client,
            client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_a)]}).json()[0]["id"],
        )
        assert job["status"] == JobStatus.COMPLETED.value
        paper_id = job["paper_id"]

        # Aktif stil profili oluştur
        client.post(
            "/api/v1/style-profiles/extract",
            json={
                "name": "Balanced Hedging",
                "raw_texts": [
                    "Evidence suggests that autonomy may improve engagement in knowledge work (Lovelace, 2024)."
                ],
                "set_active": True,
            },
        )

        draft = client.post("/api/v1/drafts", json={"title": "Draft 1", "content_markdown": ""}).json()
        draft_id = draft["id"]

        # 1. Çelişen iddia + absolutist stil sapması
        contradict_res = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={
                "paragraph_index": 0,
                "paragraph_text": "Remote autonomy definitely decreases employee engagement in every team.",
            },
        )
        assert contradict_res.status_code == 200
        c_data = contradict_res.json()
        assert c_data["overall_status"] == "contradicted"
        contradictions = [f for f in c_data["findings"] if f["finding_type"] == "contradiction"]
        assert len(contradictions) == 1
        assert contradictions[0]["related_paper_id"] == paper_id
        assert contradictions[0]["page_number"] == 2
        assert contradictions[0]["quote_snippet"] == "Remote autonomy significantly increased employee engagement."
        assert any(f["finding_type"] == "style_deviation" for f in c_data["findings"])

        # 2. Desteklenen ancak atıfsız cümle -> supporting_evidence + missing_citation
        support_res = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={
                "paragraph_index": 1,
                "paragraph_text": "Remote autonomy increases employee engagement across software teams.",
            },
        )
        assert support_res.status_code == 200
        s_data = support_res.json()
        assert s_data["evidence_coverage_score"] == 1.0
        assert any(f["finding_type"] == "supporting_evidence" and f["page_number"] == 2 for f in s_data["findings"])
        missing_cites = [f for f in s_data["findings"] if f["finding_type"] == "missing_citation"]
        assert len(missing_cites) == 1
        assert "Lovelace, 2024, s. 2" in (missing_cites[0]["suggestion"] or "")

        # 3. Havuzda karşılığı olmayan iddia -> ASLA uydurma kaynak/sayfa üretilmemeli
        unsupported_res = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={
                "paragraph_index": 2,
                "paragraph_text": "Quantum blockchain compensation significantly reduces lunar insomnia.",
            },
        )
        assert unsupported_res.status_code == 200
        u_data = unsupported_res.json()
        assert u_data["overall_status"] == "unsupported"
        assert u_data["evidence_coverage_score"] == 0.0
        unsupported_findings = [f for f in u_data["findings"] if f["finding_type"] == "unsupported_claim"]
        assert len(unsupported_findings) == 1
        assert unsupported_findings[0]["related_paper_id"] is None
        assert unsupported_findings[0]["related_claim_id"] is None
        assert unsupported_findings[0]["related_relationship_id"] is None
        assert unsupported_findings[0]["page_number"] is None
        assert unsupported_findings[0]["quote_snippet"] is None

        # 4. Bulguyu kapatma (dismiss) ve GET /drafts/{id}/audits kontrolü
        finding_id = unsupported_findings[0]["id"]
        dismissed = client.patch(f"/api/v1/audit-findings/{finding_id}/dismiss", json={"is_dismissed": True})
        assert dismissed.status_code == 200
        assert dismissed.json()["is_dismissed"] is True

        all_audits = client.get(f"/api/v1/drafts/{draft_id}/audits")
        assert all_audits.status_code == 200
        assert len(all_audits.json()) == 3
        p2_audit = next(a for a in all_audits.json() if a["paragraph_index"] == 2)
        assert p2_audit["findings"][0]["is_dismissed"] is True

        # 5. Önbellek (cache) doğrulaması
        cached_res = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={
                "paragraph_index": 2,
                "paragraph_text": "Quantum blockchain compensation significantly reduces lunar insomnia.",
                "force_refresh": False,
            },
        )
        assert cached_res.status_code == 200
        assert cached_res.json()["id"] == u_data["id"]
