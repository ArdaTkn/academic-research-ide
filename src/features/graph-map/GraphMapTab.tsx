import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import {
  AlertTriangle,
  Compass,
  FilterX,
  GitCompareArrows,
  GitFork,
  Loader2,
  Merge,
  Sparkles,
  Table2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { ConceptNode, type ConceptFlowNode } from "@/features/graph-map/ConceptNode";
import { ContradictionComparisonPanel } from "@/features/graph-map/ContradictionComparisonPanel";
import { computeDagreLayout } from "@/features/graph-map/layout";
import { VariableMergeModal } from "@/features/graph-map/VariableMergeModal";
import { useI18n } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { RelationshipDirection } from "@/types/contracts";

const NODE_TYPES = { concept: ConceptNode };

const EDGE_COLOR: Record<RelationshipDirection, string> = {
  positive: "#059669",
  negative: "#e11d48",
  insignificant: "#64748b",
  mixed: "#d97706",
  curvilinear: "#7c3aed",
};

const EDGE_SIGN: Record<RelationshipDirection, string> = {
  positive: "+",
  negative: "−",
  insignificant: "n.s.",
  mixed: "±",
  curvilinear: "∩",
};

export function GraphMapTab() {
  const { t, locale, formatNumber } = useI18n();
  const theme = useWorkspaceStore((s) => s.theme);
  const isDark = theme === "dark";
  const graphFilters = useWorkspaceStore((s) => s.graphFilters);
  const setGraphFilters = useWorkspaceStore((s) => s.setGraphFilters);
  const resetGraphFilters = useWorkspaceStore((s) => s.resetGraphFilters);
  const selectedVariableId = useWorkspaceStore((s) => s.selectedVariableId);
  const setSelectedVariableId = useWorkspaceStore((s) => s.setSelectedVariableId);
  const selectedEdgeKey = useWorkspaceStore((s) => s.selectedEdgeKey);
  const setSelectedEdgeKey = useWorkspaceStore((s) => s.setSelectedEdgeKey);
  const selectedGapPair = useWorkspaceStore((s) => s.selectedGapPair);
  const setSelectedGapPair = useWorkspaceStore((s) => s.setSelectedGapPair);
  const graphInspectorTab = useWorkspaceStore((s) => s.graphInspectorTab);
  const setGraphInspectorTab = useWorkspaceStore((s) => s.setGraphInspectorTab);
  const focusVariableInMatrix = useWorkspaceStore((s) => s.focusVariableInMatrix);

  const [isMergeOpen, setMergeOpen] = useState(false);

  const graphQuery = useQuery({
    queryKey: [
      "graph",
      locale,
      graphFilters.min_paper_count,
      graphFilters.direction,
      graphFilters.year_from,
      graphFilters.year_to,
    ],
    queryFn: () =>
      apiClient.getGraph({
        min_paper_count: graphFilters.min_paper_count,
        direction: graphFilters.direction,
        year_from: graphFilters.year_from,
        year_to: graphFilters.year_to,
      }),
  });

  const data = graphQuery.data;

  // Görünür kenarlar ("Yalnızca Çelişkiler" filtresine göre)
  const visibleGraphEdges = useMemo(() => {
    if (!data) return [];
    if (!graphFilters.onlyContradictions) return data.edges;
    return data.edges.filter((e) => e.has_contradiction);
  }, [data, graphFilters.onlyContradictions]);

  // Layout yalnızca düğüm/kenar kümesi veya yön değiştiğinde hesaplanır (seçimlerde tekrar hesaplanmaz)
  const layoutPositions = useMemo(() => {
    if (!data) return {};
    return computeDagreLayout(data.nodes, visibleGraphEdges, graphFilters.layoutDirection);
  }, [data, visibleGraphEdges, graphFilters.layoutDirection]);

  const gapEndpointSet = useMemo(() => {
    const set = new Set<string>();
    if (selectedGapPair) {
      set.add(selectedGapPair[0]);
      set.add(selectedGapPair[1]);
    }
    return set;
  }, [selectedGapPair]);

  const flowNodes: ConceptFlowNode[] = useMemo(() => {
    if (!data) return [];
    return data.nodes.map((n) => ({
      id: n.variable_id,
      type: "concept",
      position: layoutPositions[n.variable_id] ?? { x: 0, y: 0 },
      selected: selectedVariableId === n.variable_id,
      data: {
        variable_id: n.variable_id,
        label: n.display_label,
        paper_count: n.paper_count,
        roles_seen: n.roles_seen,
        degree_centrality: n.degree_centrality,
        is_gap_endpoint: gapEndpointSet.has(n.variable_id),
      },
    }));
  }, [data, layoutPositions, selectedVariableId, gapEndpointSet]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!data) return [];
    const empirical: Edge[] = visibleGraphEdges.map((edge) => {
      const isSelected = selectedEdgeKey === edge.edge_key;
      const stroke = edge.has_contradiction ? "#d97706" : EDGE_COLOR[edge.dominant_direction];
      const label = edge.has_contradiction
        ? t("graph.edgeContradiction", { count: edge.total_studies })
        : `${EDGE_SIGN[edge.dominant_direction]} (${edge.total_studies})`;

      return {
        id: edge.edge_key,
        source: edge.source_variable_id,
        target: edge.target_variable_id,
        label,
        animated: edge.has_contradiction,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        style: {
          stroke,
          strokeWidth: isSelected ? 3.5 : Math.min(3.5, 1.5 + edge.total_studies * 0.4),
          strokeDasharray: edge.dominant_direction === "insignificant" && !edge.has_contradiction ? "5 4" : undefined,
        },
        labelStyle: {
          fontSize: 11,
          fontWeight: edge.has_contradiction ? 700 : 600,
          fill: edge.has_contradiction ? (isDark ? "#fcd34d" : "#92400e") : isDark ? "#e2e8f0" : "#334155",
        },
        labelBgStyle: {
          fill: edge.has_contradiction ? (isDark ? "#451a03" : "#fef3c7") : isDark ? "#111827" : "#ffffff",
          fillOpacity: 0.92,
        },
      };
    });

    if (!graphFilters.showGaps || graphFilters.onlyContradictions) {
      return empirical;
    }

    const gapEdges: Edge[] = data.gaps.slice(0, 12).map((gap) => {
      const isPairSelected =
        selectedGapPair &&
        ((selectedGapPair[0] === gap.source_variable_id && selectedGapPair[1] === gap.target_variable_id) ||
          (selectedGapPair[1] === gap.source_variable_id && selectedGapPair[0] === gap.target_variable_id));
      return {
        id: `gap::${gap.source_variable_id}::${gap.target_variable_id}`,
        source: gap.source_variable_id,
        target: gap.target_variable_id,
        label: t("graph.edgeGap", {
          score: formatNumber(gap.gap_score, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        }),
        style: {
          stroke: "#0284c7",
          strokeWidth: isPairSelected ? 2.8 : 1.5,
          strokeDasharray: "6 5",
          opacity: isPairSelected ? 1 : 0.7,
        },
        labelStyle: { fontSize: 10, fontWeight: 600, fill: isDark ? "#7dd3fc" : "#0369a1" },
        labelBgStyle: { fill: isDark ? "#0c4a6e" : "#e0f2fe", fillOpacity: 0.92 },
      };
    });

    return [...empirical, ...gapEdges];
  }, [
    data,
    visibleGraphEdges,
    selectedEdgeKey,
    graphFilters.showGaps,
    graphFilters.onlyContradictions,
    selectedGapPair,
    isDark,
    t,
    formatNumber,
  ]);

  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.variable_id === selectedVariableId) ?? null,
    [data, selectedVariableId]
  );

  const selectedContradiction = useMemo(() => {
    if (!data || data.contradictions.length === 0) return null;
    if (selectedEdgeKey) {
      const matched = data.contradictions.find((c) => c.edge_key === selectedEdgeKey);
      if (matched) return matched;
    }
    return data.contradictions[0];
  }, [data, selectedEdgeKey]);

  const handleNodeClick: NodeMouseHandler<ConceptFlowNode> = (_event, node) => {
    setSelectedVariableId(node.id);
    setSelectedGapPair(null);
    setGraphInspectorTab("node");
  };

  const handleEdgeClick: EdgeMouseHandler = (_event, edge) => {
    if (edge.id.startsWith("gap::")) {
      const [, src, tgt] = edge.id.split("::");
      setSelectedGapPair([src, tgt]);
      setGraphInspectorTab("gaps");
      return;
    }
    setSelectedEdgeKey(edge.id);
    setSelectedGapPair(null);
    if (data?.contradictions.some((c) => c.edge_key === edge.id)) {
      setGraphInspectorTab("contradictions");
    }
  };

  const errorMessage =
    graphQuery.error instanceof ApiClientError
      ? `${graphQuery.error.error_code}: ${graphQuery.error.message}`
      : graphQuery.isError
        ? t("graph.loadFailed")
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">{t("graph.title")}</h1>
            <p className="text-xs text-slate-500">{t("graph.subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMergeOpen(true)}
              disabled={!data || data.nodes.length < 2}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Merge className="h-3.5 w-3.5 text-indigo-600" />
              <span>{t("graph.mergeVariables")}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setGraphFilters({ layoutDirection: graphFilters.layoutDirection === "LR" ? "TB" : "LR" })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Compass className="h-3.5 w-3.5 text-slate-500" />
              <span>
                {t("graph.layoutLabel")}{" "}
                {graphFilters.layoutDirection === "LR"
                  ? t("graph.layoutHorizontal")
                  : t("graph.layoutVertical")}
              </span>
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs">
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            <span>{t("graph.minPapers")}</span>
            <input
              type="number"
              min={1}
              max={50}
              aria-label={t("graph.minPapersAria")}
              value={graphFilters.min_paper_count}
              onChange={(e) =>
                setGraphFilters({ min_paper_count: Math.max(1, Number.parseInt(e.target.value || "1", 10)) })
              }
              className="w-14 rounded-md border border-slate-200 px-2 py-1 tabular-nums text-slate-900"
            />
          </label>

          <select
            aria-label={t("graph.directionAria")}
            value={graphFilters.direction ?? ""}
            onChange={(e) =>
              setGraphFilters({
                direction: (e.target.value || null) as RelationshipDirection | null,
              })
            }
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-800"
          >
            <option value="">{t("graph.allDirections")}</option>
            <option value="positive">{t("graph.dir.positive")}</option>
            <option value="negative">{t("graph.dir.negative")}</option>
            <option value="insignificant">{t("graph.dir.insignificant")}</option>
            <option value="mixed">{t("graph.dir.mixed")}</option>
            <option value="curvilinear">{t("graph.dir.curvilinear")}</option>
          </select>

          <div className="flex items-center gap-1 text-slate-600">
            <span>{t("matrix.yearLabel")}</span>
            <input
              type="number"
              aria-label={t("graph.yearFromAria")}
              placeholder={t("matrix.yearMinPlaceholder")}
              value={graphFilters.year_from ?? ""}
              onChange={(e) =>
                setGraphFilters({ year_from: e.target.value === "" ? null : Number.parseInt(e.target.value, 10) })
              }
              className="w-16 rounded-md border border-slate-200 px-2 py-1 tabular-nums text-slate-900"
            />
            <span>–</span>
            <input
              type="number"
              aria-label={t("graph.yearToAria")}
              placeholder={t("matrix.yearMaxPlaceholder")}
              value={graphFilters.year_to ?? ""}
              onChange={(e) =>
                setGraphFilters({ year_to: e.target.value === "" ? null : Number.parseInt(e.target.value, 10) })
              }
              className="w-16 rounded-md border border-slate-200 px-2 py-1 tabular-nums text-slate-900"
            />
          </div>

          <button
            type="button"
            onClick={() => setGraphFilters({ showGaps: !graphFilters.showGaps })}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition ${
              graphFilters.showGaps
                ? "border-sky-300 bg-sky-50 text-sky-800"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            <span>{t("graph.showGaps")}</span>
          </button>

          <button
            type="button"
            onClick={() => setGraphFilters({ onlyContradictions: !graphFilters.onlyContradictions })}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition ${
              graphFilters.onlyContradictions
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <GitCompareArrows className="h-3 w-3" />
            <span>{t("graph.onlyContradictions")}</span>
          </button>

          <button
            type="button"
            onClick={resetGraphFilters}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
          >
            <FilterX className="h-3 w-3" />
            <span>{t("common.reset")}</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {graphQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
              {t("graph.loading")}
            </div>
          ) : !data || data.nodes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <GitFork className="mb-3 h-10 w-10 text-slate-300" />
              <div className="text-sm font-medium text-slate-800">{t("graph.emptyTitle")}</div>
              <p className="mt-1 max-w-md text-xs text-slate-500">{t("graph.emptySubtitle")}</p>
            </div>
          ) : (
            <>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={NODE_TYPES}
                className={isDark ? "dark" : undefined}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.2}
                maxZoom={2}
              >
                <Background color={isDark ? "#334155" : "#cbd5e1"} gap={18} />
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) => (n.selected ? "#4f46e5" : "#94a3b8")}
                />
              </ReactFlow>

              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] text-slate-600 shadow-xs">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-3 rounded-xs bg-emerald-600" /> {t("graph.legend.positive")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-3 rounded-xs bg-rose-600" /> {t("graph.legend.negative")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-3 rounded-xs bg-slate-500" /> {t("graph.legend.insignificant")}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                  <span className="h-2 w-3 rounded-xs bg-amber-500" /> {t("graph.legend.contradiction")}
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-sky-800">
                  <span className="h-2 w-3 rounded-xs bg-sky-600" /> {t("graph.legend.gap")}
                </span>
              </div>
            </>
          )}
        </div>

        <aside className="flex w-[430px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setGraphInspectorTab("contradictions")}
              className={`rounded-md py-1.5 transition ${
                graphInspectorTab === "contradictions"
                  ? "bg-white text-amber-800 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("graph.tab.contradictions", { count: data?.contradictions.length ?? 0 })}
            </button>
            <button
              type="button"
              onClick={() => setGraphInspectorTab("gaps")}
              className={`rounded-md py-1.5 transition ${
                graphInspectorTab === "gaps"
                  ? "bg-white text-sky-800 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("graph.tab.gaps", { count: data?.gaps.length ?? 0 })}
            </button>
            <button
              type="button"
              onClick={() => setGraphInspectorTab("node")}
              className={`rounded-md py-1.5 transition ${
                graphInspectorTab === "node"
                  ? "bg-white text-indigo-700 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("graph.tab.node")}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {graphInspectorTab === "contradictions" && (
              <div className="space-y-4">
                {!data || data.contradictions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                    {t("graph.contradictionsEmpty")}
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {t("graph.contradictionClusters")}
                      </div>
                      {data.contradictions.map((cluster) => {
                        const active = selectedContradiction?.edge_key === cluster.edge_key;
                        return (
                          <button
                            key={cluster.edge_key}
                            type="button"
                            onClick={() => setSelectedEdgeKey(cluster.edge_key)}
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                              active
                                ? "border-amber-400 bg-amber-50/70 font-semibold text-amber-950"
                                : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                            }`}
                          >
                            <span className="truncate">
                              {cluster.source_label} → {cluster.target_label}
                            </span>
                            <span className="ml-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 tabular-nums">
                              {t("graph.findingsCount", { count: cluster.opposing_sides.length })}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {selectedContradiction && <ContradictionComparisonPanel cluster={selectedContradiction} />}
                  </>
                )}
              </div>
            )}

            {graphInspectorTab === "gaps" && (
              <div className="space-y-2.5">
                {!data || data.gaps.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                    {t("graph.gapsEmpty")}
                  </div>
                ) : (
                  data.gaps.map((gap) => {
                    const isSelected =
                      selectedGapPair &&
                      selectedGapPair[0] === gap.source_variable_id &&
                      selectedGapPair[1] === gap.target_variable_id;
                    return (
                      <button
                        key={`${gap.source_variable_id}::${gap.target_variable_id}`}
                        type="button"
                        onClick={() => setSelectedGapPair([gap.source_variable_id, gap.target_variable_id])}
                        className={`w-full rounded-xl border p-3 text-left text-xs transition ${
                          isSelected
                            ? "border-sky-400 bg-sky-50/70"
                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {gap.source_label} ↔ {gap.target_label}
                          </span>
                          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 tabular-nums">
                            {t("graph.gapScoreBadge", {
                              score: formatNumber(gap.gap_score, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                            })}
                          </span>
                        </div>
                        <div className="mt-1.5 flex gap-3 text-[11px] text-slate-600 tabular-nums">
                          <span>{t("graph.gapNeighbors", { count: gap.co_occurrence_neighbors })}</span>
                          <span>{t("graph.gapDirectStudies", { count: gap.direct_study_count })}</span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{gap.rationale}</p>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {graphInspectorTab === "node" && (
              <div>
                {!selectedNode ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                    {t("graph.nodeEmpty")}
                  </div>
                ) : (
                  <div className="space-y-4 text-xs">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                      <div className="text-sm font-semibold text-slate-900">{selectedNode.display_label}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500">{selectedNode.canonical_name}</div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
                        <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                          <span className="text-slate-500">{t("graph.nodePaperCount")}</span>{" "}
                          <strong className="text-slate-900">{formatNumber(selectedNode.paper_count)}</strong>
                        </div>
                        <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                          <span className="text-slate-500">{t("graph.nodeCentrality")}</span>{" "}
                          <strong className="text-slate-900">
                            {formatNumber(selectedNode.degree_centrality, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </strong>
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {selectedNode.roles_seen.map((role) => (
                          <span
                            key={role}
                            className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800"
                          >
                            {t(`paperDrawer.role.${role}`)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => focusVariableInMatrix(selectedNode.variable_id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        <Table2 className="h-3.5 w-3.5" />
                        <span>{t("graph.filterInMatrix")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setMergeOpen(true)}
                        disabled={!data || data.nodes.length < 2}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Merge className="h-3.5 w-3.5" />
                        <span>{t("graph.mergeIntoThis")}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <VariableMergeModal
        isOpen={isMergeOpen}
        onClose={() => setMergeOpen(false)}
        nodes={data?.nodes ?? []}
        defaultTargetId={selectedNode?.variable_id ?? null}
      />
    </div>
  );
}
