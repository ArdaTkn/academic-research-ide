from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import JobStatus, RelationshipDirection
from tests.conftest import StubLLMExtractor, build_sample_payload, make_text_pdf, wait_for_job_sync


def test_full_api_e2e_ingestion_matrix_graph_merge_config_and_delete(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_a = make_text_pdf(
        tmp_path / "paper_a.pdf",
        [
            "Page 1: Remote Work and Productivity in Tech Firms.",
            "Page 2: Remote Work positively predicted Productivity (beta = 0.45, alpha = 0.89, N = 312).",
        ],
    )
    pdf_b = make_text_pdf(
        tmp_path / "paper_b.pdf",
        [
            "Page 1: Telecommuting and Productivity in Manufacturing.",
            "Page 2: Telecommuting negatively affected Productivity (beta = -0.32, alpha = 0.74, N = 180).",
        ],
    )

    stub_llm = StubLLMExtractor()
    stub_llm.register(
        "paper_a.pdf",
        build_sample_payload(
            title="Remote Work in Tech",
            direction=RelationshipDirection.POSITIVE,
            alpha=0.89,
            sample_size=312,
            year=2024,
            page_number=2,
            extra_vars=("Remote Work", "Productivity"),
        ),
    )
    # İkinci makale kasıtlı farklı değişken adıyla ("Telecommuting") gelir -> ardından merge test edeceğiz
    stub_llm.register(
        "paper_b.pdf",
        build_sample_payload(
            title="Telecommuting in Manufacturing",
            direction=RelationshipDirection.NEGATIVE,
            alpha=0.74,
            sample_size=180,
            year=2022,
            page_number=2,
            extra_vars=("Telecommuting", "Productivity"),
        ),
    )

    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)
    with TestClient(app) as client:
        # 1. Health & Config masking
        health = client.get("/api/v1/health")
        assert health.status_code == 200
        assert health.json()["sqlite_ok"] is True
        assert health.json()["lancedb_ok"] is True

        patched = client.patch(
            "/api/v1/config",
            json={"llm_api_key": "sk-secret-value-1234", "llm_model": "qwen2.5:32b"},
        )
        assert patched.status_code == 200
        assert patched.json()["has_api_key"] is True
        assert "sk-secret-value-1234" not in patched.text

        # 2. Batch path ingest + multipart upload ingest
        r_a = client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_a)]})
        assert r_a.status_code == 202
        job_a = wait_for_job_sync(client, r_a.json()[0]["id"])
        assert job_a["status"] == JobStatus.COMPLETED.value

        # SSE stream sonlanmış iş için hemen terminal event döner
        with client.stream("GET", f"/api/v1/jobs/{job_a['id']}/stream") as stream_resp:
            assert stream_resp.status_code == 200
            body = "".join(stream_resp.iter_text())
            assert '"status":"completed"' in body

        with pdf_b.open("rb") as f:
            r_b = client.post(
                "/api/v1/papers/ingest",
                files={"files": ("paper_b.pdf", f, "application/pdf")},
            )
        assert r_b.status_code == 202
        job_b = wait_for_job_sync(client, r_b.json()[0]["id"])
        assert job_b["status"] == JobStatus.COMPLETED.value

        # 3. Papers list & detail
        papers_res = client.get("/api/v1/papers")
        assert papers_res.status_code == 200
        assert papers_res.json()["total"] == 2

        # 4. Scale & Method Matrix filters + CSV export
        matrix_filtered = client.get("/api/v1/matrix/scales?min_alpha=0.80&min_sample_size=250")
        assert matrix_filtered.status_code == 200
        assert matrix_filtered.json()["total"] == 1
        assert matrix_filtered.json()["items"][0]["cronbach_alpha"] == 0.89

        methods = client.get("/api/v1/matrix/methods")
        assert methods.status_code == 200
        assert any(m["method"] == "SEM" and m["count"] == 2 for m in methods.json())

        csv_export = client.get("/api/v1/matrix/export?format=csv")
        assert csv_export.status_code == 200
        assert "text/csv" in csv_export.headers["content-type"]
        assert "Utrecht Work Engagement Scale" in csv_export.text

        # 5. Graph + Variable Merge -> Contradiction Cluster oluşmalı
        g1 = client.get("/api/v1/graph").json()
        assert len(g1["nodes"]) == 3
        remote_node = next(n for n in g1["nodes"] if n["display_label"] == "Remote Work")
        tele_node = next(n for n in g1["nodes"] if n["display_label"] == "Telecommuting")

        merged = client.post(
            "/api/v1/variables/merge",
            json={
                "source_variable_ids": [tele_node["variable_id"]],
                "target_variable_id": remote_node["variable_id"],
            },
        )
        assert merged.status_code == 200
        assert "Telecommuting" in merged.json()["aliases"]

        contradictions = client.get("/api/v1/graph/contradictions").json()
        assert len(contradictions) == 1
        assert len(contradictions[0]["opposing_sides"]) == 2
        directions = {s["direction"] for s in contradictions[0]["opposing_sides"]}
        assert directions == {"positive", "negative"}

        # 6. Drafts CRUD + Canlı Audit + 404 ApiError envelope
        draft_res = client.post("/api/v1/drafts", json={"title": "Literature Review", "content_markdown": "# Intro"})
        assert draft_res.status_code == 201
        draft_id = draft_res.json()["id"]

        audit_res = client.post(
            f"/api/v1/drafts/{draft_id}/audit",
            json={"paragraph_index": 0, "paragraph_text": "Remote work increases productivity."},
        )
        assert audit_res.status_code == 200
        audit_body = audit_res.json()
        assert audit_body["overall_status"] == "contradicted"
        assert any(f["finding_type"] == "supporting_evidence" for f in audit_body["findings"])
        assert any(f["finding_type"] == "contradiction" for f in audit_body["findings"])

        missing = client.get("/api/v1/papers/non-existent-id")
        assert missing.status_code == 404
        assert missing.json()["error_code"] == "PAPER_NOT_FOUND"
        assert "request_id" in missing.json()

        # 7. Delete paper cleans SQLite & LanceDB
        paper_a_id = job_a["paper_id"]
        del_res = client.delete(f"/api/v1/papers/{paper_a_id}")
        assert del_res.status_code == 200
        assert del_res.json()["deleted"] is True

        vec_hits = app.state.vector_store.search_paper_chunks(
            local_embedder.embed_texts(["Remote Work"])[0],
            limit=5,
            paper_id=paper_a_id,
        )
        assert vec_hits == []
