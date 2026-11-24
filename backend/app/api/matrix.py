from __future__ import annotations

import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response

from app.api.deps import get_repo, get_request_locale
from app.core.i18n import CSV_HEADERS, Locale
from app.db.sqlite import ResearchRepository
from app.models.schemas import MethodCountItem, ScaleMatrixFilter, ScaleMatrixResponse

router = APIRouter(tags=["matrix"])


def _build_filter(
    *,
    search: str | None,
    variable_id: str | None,
    min_alpha: float | None,
    max_alpha: float | None,
    min_sample_size: int | None,
    statistical_method: str | None,
    year_from: int | None,
    year_to: int | None,
    sort_by: str,
    sort_dir: Literal["asc", "desc"],
    limit: int,
    offset: int,
) -> ScaleMatrixFilter:
    return ScaleMatrixFilter(
        search=search,
        variable_id=variable_id,
        min_alpha=min_alpha,
        max_alpha=max_alpha,
        min_sample_size=min_sample_size,
        statistical_method=statistical_method,
        year_from=year_from,
        year_to=year_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )


@router.get("/matrix/scales", response_model=ScaleMatrixResponse)
def get_scale_matrix(
    search: str | None = Query(default=None),
    variable_id: str | None = Query(default=None),
    min_alpha: float | None = Query(default=None, ge=0.0, le=1.0),
    max_alpha: float | None = Query(default=None, ge=0.0, le=1.0),
    min_sample_size: int | None = Query(default=None, ge=0),
    statistical_method: str | None = Query(default=None),
    year_from: int | None = Query(default=None, ge=1800, le=2100),
    year_to: int | None = Query(default=None, ge=1800, le=2100),
    sort_by: str = Query(default="year"),
    sort_dir: Literal["asc", "desc"] = Query(default="desc"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    repo: ResearchRepository = Depends(get_repo),
) -> ScaleMatrixResponse:
    filters = _build_filter(
        search=search,
        variable_id=variable_id,
        min_alpha=min_alpha,
        max_alpha=max_alpha,
        min_sample_size=min_sample_size,
        statistical_method=statistical_method,
        year_from=year_from,
        year_to=year_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )
    return repo.query_scale_matrix(filters)


@router.get("/matrix/methods", response_model=list[MethodCountItem])
def get_matrix_methods(
    repo: ResearchRepository = Depends(get_repo),
) -> list[MethodCountItem]:
    return repo.list_statistical_methods()


@router.get("/matrix/export")
def export_scale_matrix(
    format: Literal["csv", "json"] = Query(default="csv"),
    search: str | None = Query(default=None),
    variable_id: str | None = Query(default=None),
    min_alpha: float | None = Query(default=None, ge=0.0, le=1.0),
    max_alpha: float | None = Query(default=None, ge=0.0, le=1.0),
    min_sample_size: int | None = Query(default=None, ge=0),
    statistical_method: str | None = Query(default=None),
    year_from: int | None = Query(default=None, ge=1800, le=2100),
    year_to: int | None = Query(default=None, ge=1800, le=2100),
    sort_by: str = Query(default="year"),
    sort_dir: Literal["asc", "desc"] = Query(default="desc"),
    locale: Locale = Depends(get_request_locale),
    repo: ResearchRepository = Depends(get_repo),
) -> Response:
    filters = _build_filter(
        search=search,
        variable_id=variable_id,
        min_alpha=min_alpha,
        max_alpha=max_alpha,
        min_sample_size=min_sample_size,
        statistical_method=statistical_method,
        year_from=year_from,
        year_to=year_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=500,
        offset=0,
    )
    result = repo.query_scale_matrix(filters)

    if format == "json":
        return JSONResponse(
            content=[item.model_dump() for item in result.items],
            headers={"Content-Disposition": 'attachment; filename="scale_matrix.json"'},
        )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_HEADERS[locale])
    for row in result.items:
        writer.writerow(
            [
                row.scale_id,
                row.paper_id,
                row.paper_title,
                "; ".join(row.authors),
                row.year if row.year is not None else "",
                row.variable_label or "",
                row.scale_name,
                row.original_authors or "",
                row.original_year if row.original_year is not None else "",
                row.item_count if row.item_count is not None else "",
                row.cronbach_alpha if row.cronbach_alpha is not None else "",
                row.composite_reliability if row.composite_reliability is not None else "",
                row.ave if row.ave is not None else "",
                row.response_format or "",
                row.sample_size if row.sample_size is not None else "",
                row.sample_population or "",
                "; ".join(row.statistical_methods),
                row.research_design or "",
                row.page_number,
            ]
        )

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="scale_matrix.csv"'},
    )
