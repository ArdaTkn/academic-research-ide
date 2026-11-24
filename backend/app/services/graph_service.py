from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.models.schemas import (
    ContradictionCluster,
    ContradictionPaperSide,
    GraphEdge,
    GraphNode,
    GraphResponse,
    RelationshipDirection,
    ResearchGap,
    VariableRole,
)

if TYPE_CHECKING:
    from app.db.sqlite import ResearchRepository


@dataclass(slots=True)
class GraphSnapshot:
    variables: list[dict[str, Any]]
    paper_variables: list[dict[str, Any]]
    relationships: list[dict[str, Any]]


class GraphService:
    """Computes concept graphs, truthful research gaps, and contradiction clusters."""

    def __init__(self, repo: ResearchRepository) -> None:
        self.repo = repo

    def build_graph(
        self,
        *,
        min_paper_count: int = 1,
        direction: RelationshipDirection | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        variable_ids: list[str] | None = None,
    ) -> GraphResponse:
        snapshot = self.repo.fetch_graph_snapshot()
        var_map: dict[str, dict[str, Any]] = {v["id"]: v for v in snapshot.variables}
        selected_var_set = set(variable_ids) if variable_ids else None

        filtered_rels: list[dict[str, Any]] = []
        for r in snapshot.relationships:
            if year_from is not None and (r["year"] is None or r["year"] < year_from):
                continue
            if year_to is not None and (r["year"] is None or r["year"] > year_to):
                continue
            if direction is not None and r["direction"] != direction.value:
                continue
            if selected_var_set and (
                r["source_variable_id"] not in selected_var_set
                and r["target_variable_id"] not in selected_var_set
            ):
                continue
            filtered_rels.append(r)

        papers_per_var: dict[str, set[str]] = {}
        roles_per_var: dict[str, set[VariableRole]] = {}
        for pv in snapshot.paper_variables:
            if year_from is not None and (pv["year"] is None or pv["year"] < year_from):
                continue
            if year_to is not None and (pv["year"] is None or pv["year"] > year_to):
                continue
            vid = pv["variable_id"]
            papers_per_var.setdefault(vid, set()).add(pv["paper_id"])
            roles_per_var.setdefault(vid, set()).add(VariableRole(pv["role"]))

        for r in filtered_rels:
            for vid, role_col in (
                (r["source_variable_id"], r["source_role"]),
                (r["target_variable_id"], r["target_role"]),
            ):
                papers_per_var.setdefault(vid, set()).add(r["paper_id"])
                if role_col:
                    roles_per_var.setdefault(vid, set()).add(VariableRole(role_col))

        included_var_ids: set[str] = set()
        for vid in var_map:
            if selected_var_set and vid not in selected_var_set:
                continue
            if len(papers_per_var.get(vid, set())) >= min_paper_count:
                included_var_ids.add(vid)

        edge_groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for r in filtered_rels:
            s_id = r["source_variable_id"]
            t_id = r["target_variable_id"]
            if s_id in included_var_ids and t_id in included_var_ids:
                edge_groups.setdefault((s_id, t_id), []).append(r)

        edges: list[GraphEdge] = []
        contradictions: list[ContradictionCluster] = []
        adj: dict[str, set[str]] = {vid: set() for vid in included_var_ids}

        for (s_id, t_id), group in sorted(edge_groups.items()):
            if s_id != t_id:
                adj[s_id].add(t_id)
                adj[t_id].add(s_id)

            counts = {d.value: 0 for d in RelationshipDirection}
            for r in group:
                counts[r["direction"]] += 1

            dominant = max(RelationshipDirection, key=lambda d: counts[d.value])
            has_pos_neg = counts["positive"] > 0 and counts["negative"] > 0
            has_sig_vs_insig = (counts["positive"] > 0 or counts["negative"] > 0) and counts["insignificant"] > 0
            has_contradiction = has_pos_neg or has_sig_vs_insig or counts["mixed"] > 0
            edge_key = f"{s_id}->{t_id}"

            edges.append(
                GraphEdge(
                    edge_key=edge_key,
                    source_variable_id=s_id,
                    target_variable_id=t_id,
                    total_studies=len(group),
                    positive_count=counts["positive"],
                    negative_count=counts["negative"],
                    insignificant_count=counts["insignificant"],
                    mixed_count=counts["mixed"],
                    curvilinear_count=counts["curvilinear"],
                    dominant_direction=dominant,
                    has_contradiction=has_contradiction,
                    relationship_ids=[r["id"] for r in group],
                )
            )

            if has_contradiction:
                total = len(group)
                dominant_cnt = counts[dominant.value]
                score = round(
                    min(1.0, max(0.2, 1.0 - (dominant_cnt / total) + (0.25 if has_pos_neg else 0.1))),
                    3,
                )
                sides: list[ContradictionPaperSide] = []
                for r in sorted(group, key=lambda x: (x["direction"], -(x["year"] or 0), x["paper_title"])):
                    paper_methods = json.loads(r["statistical_methods_json"] or "[]")
                    stat_method = r["statistical_method"] or (
                        ", ".join(paper_methods) if paper_methods else None
                    )
                    sides.append(
                        ContradictionPaperSide(
                            paper_id=r["paper_id"],
                            paper_title=r["paper_title"],
                            authors=json.loads(r["authors_json"] or "[]"),
                            year=r["year"],
                            sample_size=r["sample_size"],
                            statistical_method=stat_method,
                            relationship_id=r["id"],
                            direction=RelationshipDirection(r["direction"]),
                            effect_size=r["effect_size"],
                            effect_metric=r["effect_metric"],
                            p_value=r["p_value"],
                            page_number=r["page_number"],
                            quote_snippet=r["quote_snippet"],
                        )
                    )
                contradictions.append(
                    ContradictionCluster(
                        edge_key=edge_key,
                        source_variable_id=s_id,
                        source_label=var_map[s_id]["display_label"],
                        target_variable_id=t_id,
                        target_label=var_map[t_id]["display_label"],
                        contradiction_score=score,
                        opposing_sides=sides,
                    )
                )

        max_deg = max(1, len(included_var_ids) - 1)
        nodes: list[GraphNode] = []
        for vid in sorted(included_var_ids, key=lambda x: var_map[x]["display_label"]):
            vrow = var_map[vid]
            nodes.append(
                GraphNode(
                    variable_id=vid,
                    canonical_name=vrow["canonical_name"],
                    display_label=vrow["display_label"],
                    domain_tag=vrow["domain_tag"],
                    paper_count=len(papers_per_var.get(vid, set())),
                    roles_seen=sorted(roles_per_var.get(vid, set()), key=lambda x: x.value),
                    degree_centrality=round(len(adj.get(vid, set())) / max_deg, 4),
                )
            )

        gaps = self._compute_gaps(included_var_ids, var_map, adj, edge_groups, papers_per_var)
        return GraphResponse(
            nodes=nodes,
            edges=edges,
            gaps=gaps,
            contradictions=sorted(contradictions, key=lambda c: (-c.contradiction_score, c.edge_key)),
        )

    @staticmethod
    def _compute_gaps(
        var_ids: set[str],
        var_map: dict[str, dict[str, Any]],
        adj: dict[str, set[str]],
        edge_groups: dict[tuple[str, str], list[dict[str, Any]]],
        papers_per_var: dict[str, set[str]],
    ) -> list[ResearchGap]:
        ordered = sorted(var_ids)
        gaps: list[ResearchGap] = []
        for i in range(len(ordered)):
            for j in range(i + 1, len(ordered)):
                a = ordered[i]
                b = ordered[j]
                direct = len(edge_groups.get((a, b), [])) + len(edge_groups.get((b, a), []))
                common = len(adj.get(a, set()) & adj.get(b, set()))
                if direct == 0 and common > 0:
                    score = round(min(1.0, common / max(2.0, common + 1.5)), 3)
                    gaps.append(
                        ResearchGap(
                            source_variable_id=a,
                            source_label=var_map[a]["display_label"],
                            target_variable_id=b,
                            target_label=var_map[b]["display_label"],
                            co_occurrence_neighbors=common,
                            direct_study_count=0,
                            gap_score=score,
                            rationale=(
                                f"{common} ortak komşu değişken üzerinden dolaylı bağlantılı, "
                                "ancak doğrudan ampirik test bulunmuyor (0 çalışma)."
                            ),
                        )
                    )
                elif (
                    direct == 1
                    and common >= 1
                    and len(papers_per_var.get(a, set())) >= 2
                    and len(papers_per_var.get(b, set())) >= 2
                ):
                    score = round(min(0.65, common / (common + 3.0)), 3)
                    gaps.append(
                        ResearchGap(
                            source_variable_id=a,
                            source_label=var_map[a]["display_label"],
                            target_variable_id=b,
                            target_label=var_map[b]["display_label"],
                            co_occurrence_neighbors=common,
                            direct_study_count=1,
                            gap_score=score,
                            rationale=(
                                f"Her iki kavram en az 2 makalede geçiyor ve {common} ortak komşuya sahip, "
                                "ancak aralarında yalnızca 1 doğrudan çalışma bulunuyor."
                            ),
                        )
                    )
        return sorted(gaps, key=lambda g: (-g.gap_score, -g.co_occurrence_neighbors, g.source_label))

    def compute_research_gaps(self, *, limit: int = 20, min_gap_score: float = 0.0) -> list[ResearchGap]:
        graph = self.build_graph()
        return [g for g in graph.gaps if g.gap_score >= min_gap_score][:limit]

    def compute_contradictions(self, edge_key: str | None = None) -> list[ContradictionCluster]:
        graph = self.build_graph()
        if edge_key:
            return [c for c in graph.contradictions if c.edge_key == edge_key]
        return graph.contradictions
