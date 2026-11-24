from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.vector_store import LocalHashEmbedder
from app.main import create_app
from app.models.schemas import (
    ExtractedMetadata,
    ExtractedRelationship,
    ExtractedSampleProfile,
    ExtractedVariable,
    JobStatus,
    PaperExtractionPayload,
    RelationshipDirection,
    VariableRole,
)
from tests.conftest import StubLLMExtractor, build_sample_payload, make_text_pdf, wait_for_job_sync


def test_graph_isolated_nodes_cycles_and_non_contradictory_edges(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_1 = make_text_pdf(
        tmp_path / "cycle.pdf",
        [
            "Page 1: Autonomy, motivation, and performance cycle study in software organizations.",
            "Page 2: Empirical structural equation modeling findings confirm all three directed paths.",
        ],
    )
    payload = PaperExtractionPayload(
        metadata=ExtractedMetadata(title="Cyclic Study", authors=["Author A"], year=2023),
        sample_profile=ExtractedSampleProfile(sample_size=220, statistical_methods=["Path Analysis"]),
        variables=[
            ExtractedVariable(name="Autonomy", role=VariableRole.INDEPENDENT, page_number=1),
            ExtractedVariable(name="Motivation", role=VariableRole.MEDIATOR, page_number=1),
            ExtractedVariable(name="Performance", role=VariableRole.DEPENDENT, page_number=1),
            ExtractedVariable(name="Tenure", role=VariableRole.CONTROL, page_number=1),  # izole düğüm
        ],
        relationships=[
            ExtractedRelationship(
                source_variable="Autonomy",
                target_variable="Motivation",
                direction=RelationshipDirection.POSITIVE,
                page_number=2,
            ),
            ExtractedRelationship(
                source_variable="Motivation",
                target_variable="Performance",
                direction=RelationshipDirection.POSITIVE,
                page_number=2,
            ),
            ExtractedRelationship(
                source_variable="Performance",
                target_variable="Autonomy",
                direction=RelationshipDirection.POSITIVE,
                page_number=2,
            ),
        ],
    )

    stub_llm = StubLLMExtractor(payload=payload)
    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)
    with TestClient(app) as client:
        r = client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_1)]})
        job = wait_for_job_sync(client, r.json()[0]["id"])
        assert job["status"] == JobStatus.COMPLETED.value

        graph = client.get("/api/v1/graph").json()
        assert len(graph["nodes"]) == 4
        assert len(graph["edges"]) == 3
        assert graph["contradictions"] == []

        tenure_node = next(n for n in graph["nodes"] if n["display_label"] == "Tenure")
        assert tenure_node["degree_centrality"] == 0.0
        assert graph["gaps"] == []


def test_truthful_research_gaps_and_post_merge_contradiction_consistency(
    tmp_path: Path,
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    pdf_a = make_text_pdf(
        tmp_path / "a.pdf",
        [
            "Page 1: Trust, work engagement, and retention investigation across corporate teams.",
            "Page 2: Structural equation modeling shows trust boosts engagement and retention.",
        ],
    )
    pdf_b = make_text_pdf(
        tmp_path / "b.pdf",
        [
            "Page 1: Organizational trust paradox and employee engagement in rigid hierarchies.",
            "Page 2: Regression analysis indicates negative association under high control.",
        ],
    )

    stub_llm = StubLLMExtractor()
    # Makale A: Trust -> Engagement (+) ve Engagement -> Retention (+)
    stub_llm.register(
        "a.pdf",
        PaperExtractionPayload(
            metadata=ExtractedMetadata(title="Trust & Retention Study", authors=["Lovelace"], year=2024),
            sample_profile=ExtractedSampleProfile(sample_size=400, statistical_methods=["SEM"]),
            variables=[
                ExtractedVariable(name="Trust", role=VariableRole.INDEPENDENT, page_number=1),
                ExtractedVariable(name="Engagement", role=VariableRole.MEDIATOR, page_number=1),
                ExtractedVariable(name="Retention", role=VariableRole.DEPENDENT, page_number=1),
            ],
            relationships=[
                ExtractedRelationship(
                    source_variable="Trust",
                    target_variable="Engagement",
                    direction=RelationshipDirection.POSITIVE,
                    effect_size=0.51,
                    effect_metric="beta",
                    p_value="< 0.001",
                    page_number=2,
                    quote_snippet="Trust strongly elevated work engagement.",
                ),
                ExtractedRelationship(
                    source_variable="Engagement",
                    target_variable="Retention",
                    direction=RelationshipDirection.POSITIVE,
                    effect_size=0.44,
                    effect_metric="beta",
                    p_value="< 0.001",
                    page_number=2,
                ),
            ],
        ),
    )
    # Makale B: Organizational Trust (sonradan Trust ile birleşecek) -> Engagement (-)
    stub_llm.register(
        "b.pdf",
        build_sample_payload(
            title="Organizational Trust Paradox",
            direction=RelationshipDirection.NEGATIVE,
            sample_size=145,
            year=2021,
            page_number=2,
            extra_vars=("Organizational Trust", "Engagement"),
        ),
    )

    app = create_app(settings=temp_settings, llm_extractor=stub_llm, embedder=local_embedder)
    with TestClient(app) as client:
        j1 = wait_for_job_sync(client, client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_a)]}).json()[0]["id"])
        j2 = wait_for_job_sync(client, client.post("/api/v1/papers/ingest", json={"file_paths": [str(pdf_b)]}).json()[0]["id"])
        assert j1["status"] == JobStatus.COMPLETED.value
        assert j2["status"] == JobStatus.COMPLETED.value

        # Trust <-> Retention doğrudan çalışılmamış ancak ortak komşuları Engagement var -> ResearchGap oluşmalı
        gaps = client.get("/api/v1/graph/gaps").json()
        assert any(
            {g["source_label"], g["target_label"]} == {"Trust", "Retention"}
            and g["direct_study_count"] == 0
            and g["co_occurrence_neighbors"] == 1
            for g in gaps
        )

        # Merge öncesi çelişki yok (Trust vs Organizational Trust ayrı)
        assert client.get("/api/v1/graph/contradictions").json() == []

        g_before = client.get("/api/v1/graph").json()
        trust_id = next(n["variable_id"] for n in g_before["nodes"] if n["display_label"] == "Trust")
        org_trust_id = next(n["variable_id"] for n in g_before["nodes"] if n["display_label"] == "Organizational Trust")

        merge_res = client.post(
            "/api/v1/variables/merge",
            json={"source_variable_ids": [org_trust_id], "target_variable_id": trust_id},
        )
        assert merge_res.status_code == 200

        # Merge sonrası graf, çelişki ve boşluklar güncel & tutarlı olmalı
        g_after = client.get("/api/v1/graph").json()
        assert all(n["variable_id"] != org_trust_id for n in g_after["nodes"])
        assert len(g_after["contradictions"]) == 1

        c = g_after["contradictions"][0]
        assert c["source_label"] == "Trust"
        assert c["target_label"] == "Engagement"
        assert len(c["opposing_sides"]) == 2
        # Makale A relationship-level statistical_method null ise paper-level ("SEM") fallback olarak gelmeli
        side_a = next(s for s in c["opposing_sides"] if s["paper_title"] == "Trust & Retention Study")
        assert side_a["statistical_method"] == "SEM"
        assert side_a["sample_size"] == 400
        assert side_a["page_number"] == 2


def test_large_graph_performance_60_nodes_180_edges(
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    app = create_app(settings=temp_settings, llm_extractor=StubLLMExtractor(), embedder=local_embedder)
    with TestClient(app) as client:
        repo = app.state.repo
        paper = repo.create_or_reset_paper_stub(
            file_path="/tmp/large.pdf",
            file_hash_sha256="largehash60",
            page_count=20,
            title_hint="Large Benchmark",
        )
        variables = [
            ExtractedVariable(name=f"Concept {i}", role=VariableRole.INDEPENDENT, page_number=1)
            for i in range(60)
        ]
        relationships = []
        for i in range(60):
            for offset in (1, 2, 3):
                relationships.append(
                    ExtractedRelationship(
                        source_variable=f"Concept {i}",
                        target_variable=f"Concept {(i + offset) % 60}",
                        direction=RelationshipDirection.POSITIVE if offset % 2 else RelationshipDirection.NEGATIVE,
                        page_number=2,
                    )
                )
        payload = PaperExtractionPayload(
            metadata=ExtractedMetadata(title="Large Graph Paper", authors=["Tester"], year=2024),
            sample_profile=ExtractedSampleProfile(sample_size=500, statistical_methods=["SEM"]),
            variables=variables,
            relationships=relationships,
        )
        repo.persist_validated_extraction(paper_id=paper.id, payload=payload)
        repo.mark_paper_completed(paper.id)

        t0 = time.perf_counter()
        res = client.get("/api/v1/graph")
        elapsed = time.perf_counter() - t0
        assert res.status_code == 200
        body = res.json()
        assert len(body["nodes"]) == 60
        assert len(body["edges"]) == 180
        assert elapsed < 2.0
