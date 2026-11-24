import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphMapTab } from "@/features/graph-map/GraphMapTab";
import { computeDagreLayout } from "@/features/graph-map/layout";
import { DEFAULT_GRAPH_FILTERS, useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { GraphEdge, GraphNode, GraphResponse } from "@/types/contracts";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAMPLE_GRAPH: GraphResponse = {
  nodes: [
    {
      variable_id: "v-1",
      canonical_name: "Remote Work",
      display_label: "Remote Work",
      domain_tag: "OB",
      paper_count: 3,
      roles_seen: ["independent"],
      degree_centrality: 0.5,
    },
    {
      variable_id: "v-2",
      canonical_name: "Job Satisfaction",
      display_label: "Job Satisfaction",
      domain_tag: "OB",
      paper_count: 3,
      roles_seen: ["mediator", "dependent"],
      degree_centrality: 1.0,
    },
    {
      variable_id: "v-3",
      canonical_name: "Turnover Intention",
      display_label: "Turnover Intention",
      domain_tag: "OB",
      paper_count: 2,
      roles_seen: ["dependent"],
      degree_centrality: 0.5,
    },
  ],
  edges: [
    {
      edge_key: "v-1->v-2",
      source_variable_id: "v-1",
      target_variable_id: "v-2",
      total_studies: 2,
      positive_count: 1,
      negative_count: 1,
      insignificant_count: 0,
      mixed_count: 0,
      curvilinear_count: 0,
      dominant_direction: "positive",
      has_contradiction: true,
      relationship_ids: ["r-1", "r-2"],
    },
    {
      edge_key: "v-2->v-3",
      source_variable_id: "v-2",
      target_variable_id: "v-3",
      total_studies: 1,
      positive_count: 0,
      negative_count: 1,
      insignificant_count: 0,
      mixed_count: 0,
      curvilinear_count: 0,
      dominant_direction: "negative",
      has_contradiction: false,
      relationship_ids: ["r-3"],
    },
  ],
  gaps: [
    {
      source_variable_id: "v-1",
      source_label: "Remote Work",
      target_variable_id: "v-3",
      target_label: "Turnover Intention",
      co_occurrence_neighbors: 1,
      direct_study_count: 0,
      gap_score: 0.5,
      rationale: "1 ortak komşu değişken üzerinden dolaylı bağlantılı, ancak doğrudan ampirik test bulunmuyor.",
    },
  ],
  contradictions: [
    {
      edge_key: "v-1->v-2",
      source_variable_id: "v-1",
      source_label: "Remote Work",
      target_variable_id: "v-2",
      target_label: "Job Satisfaction",
      contradiction_score: 0.75,
      opposing_sides: [
        {
          paper_id: "p-1",
          paper_title: "Hybrid Autonomy in Tech",
          authors: ["Ada Lovelace"],
          year: 2024,
          sample_size: 420,
          statistical_method: "SEM",
          relationship_id: "r-1",
          direction: "positive",
          effect_size: 0.48,
          effect_metric: "beta",
          p_value: "< 0.001",
          page_number: 6,
          quote_snippet: "Remote work boosted satisfaction via autonomy.",
        },
        {
          paper_id: "p-2",
          paper_title: "Isolation Effects in Shift Teams",
          authors: ["Alan Turing"],
          year: 2022,
          sample_size: 165,
          statistical_method: "OLS Regression",
          relationship_id: "r-2",
          direction: "negative",
          effect_size: -0.29,
          effect_metric: "beta",
          p_value: "0.012",
          page_number: 9,
          quote_snippet: "Remote schedules reduced satisfaction due to isolation.",
        },
      ],
    },
  ],
};

describe("computeDagreLayout", () => {
  it("handles isolated nodes, cycles, and 60-node graphs with finite coordinates", () => {
    const nodes: GraphNode[] = Array.from({ length: 60 }, (_, idx) => ({
      variable_id: `n-${idx}`,
      canonical_name: `Concept ${idx}`,
      display_label: `Concept ${idx}`,
      domain_tag: null,
      paper_count: 1,
      roles_seen: ["independent"],
      degree_centrality: 0.1,
    }));
    const edges: GraphEdge[] = Array.from({ length: 50 }, (_, idx) => ({
      edge_key: `n-${idx}->n-${(idx + 1) % 50}`,
      source_variable_id: `n-${idx}`,
      target_variable_id: `n-${(idx + 1) % 50}`,
      total_studies: 1,
      positive_count: 1,
      negative_count: 0,
      insignificant_count: 0,
      mixed_count: 0,
      curvilinear_count: 0,
      dominant_direction: "positive",
      has_contradiction: false,
      relationship_ids: [`r-${idx}`],
    }));

    const positions = computeDagreLayout(nodes, edges, "LR");
    expect(Object.keys(positions)).toHaveLength(60);
    for (const pos of Object.values(positions)) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});

describe("GraphMapTab", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      locale: "en",
      activeTab: "graph",
      selectedPaperId: null,
      selectedVariableId: null,
      selectedEdgeKey: null,
      selectedGapPair: null,
      graphInspectorTab: "contradictions",
      graphFilters: { ...DEFAULT_GRAPH_FILTERS },
    });
  });

  it("renders contradictions side-by-side with sample/method/page refs and navigates to paper detail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_GRAPH), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    renderWithQuery(<GraphMapTab />);

    expect(await screen.findByText("Hybrid Autonomy in Tech")).toBeInTheDocument();
    expect(screen.getByText("Isolation Effects in Shift Teams")).toBeInTheDocument();
    expect(screen.getByText("SEM")).toBeInTheDocument();
    expect(screen.getByText("OLS Regression")).toBeInTheDocument();
    expect(screen.getByText("p. 6")).toBeInTheDocument();
    expect(screen.getByText("p. 9")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Hybrid Autonomy in Tech"));
    expect(useWorkspaceStore.getState().selectedPaperId).toBe("p-1");

    fireEvent.click(screen.getByRole("button", { name: /^Gaps \(\d+\)$/ }));
    expect(await screen.findByText(/Remote Work ↔ Turnover Intention/)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  it("links selected node to Tab 2 via focusVariableInMatrix and supports variable merge", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("/variables/merge") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "v-1",
              canonical_name: "Remote Work",
              normalized_key: "remote work",
              display_label: "Remote Work",
              aliases: ["Turnover Intention"],
              definition: null,
              domain_tag: "OB",
              created_at: "2026-11-24T00:00:00Z",
              updated_at: "2026-11-24T00:00:00Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(SAMPLE_GRAPH), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    useWorkspaceStore.setState({ selectedVariableId: "v-2", graphInspectorTab: "node" });
    renderWithQuery(<GraphMapTab />);

    expect(await screen.findByRole("button", { name: "Filter in Scale Matrix" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter in Scale Matrix" }));
    expect(useWorkspaceStore.getState().activeTab).toBe("matrix");
    expect(useWorkspaceStore.getState().matrixFilters.variable_id).toBe("v-2");

    useWorkspaceStore.setState({ activeTab: "graph" });
    fireEvent.click(screen.getByRole("button", { name: "Merge Variables" }));
    expect(await screen.findByText("Canonical Variable Merge")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/variables/merge"),
        expect.objectContaining({ method: "POST" })
      );
    });

    fetchSpy.mockRestore();
  });

  it("displays structured ApiError banner if graph request fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error_code: "GRAPH_BUILD_FAILED",
          message: "Grafik oluşturulamadı.",
          details: {},
          request_id: "req-g1",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );

    renderWithQuery(<GraphMapTab />);
    expect(await screen.findByText(/GRAPH_BUILD_FAILED: Grafik oluşturulamadı\./)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });
});
