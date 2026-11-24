from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_graph_service, get_repo
from app.db.sqlite import ResearchRepository
from app.models.schemas import (
    ContradictionCluster,
    GraphResponse,
    RelationshipDirection,
    ResearchGap,
    Variable,
    VariableMergeRequest,
)
from app.services.graph_service import GraphService

router = APIRouter(tags=["graph"])


@router.get("/graph", response_model=GraphResponse)
def get_graph(
    min_paper_count: int = Query(default=1, ge=1),
    direction: RelationshipDirection | None = Query(default=None),
    year_from: int | None = Query(default=None, ge=1800, le=2100),
    year_to: int | None = Query(default=None, ge=1800, le=2100),
    variable_ids: list[str] | None = Query(default=None),
    graph_service: GraphService = Depends(get_graph_service),
) -> GraphResponse:
    return graph_service.build_graph(
        min_paper_count=min_paper_count,
        direction=direction,
        year_from=year_from,
        year_to=year_to,
        variable_ids=variable_ids,
    )


@router.get("/graph/gaps", response_model=list[ResearchGap])
def get_graph_gaps(
    limit: int = Query(default=20, ge=1, le=200),
    min_gap_score: float = Query(default=0.0, ge=0.0, le=1.0),
    graph_service: GraphService = Depends(get_graph_service),
) -> list[ResearchGap]:
    return graph_service.compute_research_gaps(limit=limit, min_gap_score=min_gap_score)


@router.get("/graph/contradictions", response_model=list[ContradictionCluster])
def get_graph_contradictions(
    edge_key: str | None = Query(default=None),
    graph_service: GraphService = Depends(get_graph_service),
) -> list[ContradictionCluster]:
    return graph_service.compute_contradictions(edge_key=edge_key)


@router.post("/variables/merge", response_model=Variable)
def merge_variables(
    body: VariableMergeRequest,
    repo: ResearchRepository = Depends(get_repo),
) -> Variable:
    return repo.merge_variables(body.source_variable_ids, body.target_variable_id)
