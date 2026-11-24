import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScaleMatrixTab } from "@/features/scale-matrix/ScaleMatrixTab";
import { DEFAULT_MATRIX_FILTERS, useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { ScaleMatrixResponse } from "@/types/contracts";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAMPLE_MATRIX_RESPONSE: ScaleMatrixResponse = {
  items: [
    {
      scale_id: "s-1",
      paper_id: "p-1",
      paper_title: "Remote Work and Engagement",
      authors: ["Ada Lovelace"],
      year: 2024,
      variable_id: "v-1",
      variable_label: "Work Engagement",
      scale_name: "Utrecht Work Engagement Scale",
      original_authors: "Schaufeli et al.",
      original_year: 2006,
      item_count: 9,
      cronbach_alpha: 0.89,
      composite_reliability: 0.91,
      ave: 0.64,
      response_format: "7-point Likert",
      sample_size: 312,
      sample_population: "Software Engineers",
      statistical_methods: ["SEM", "CFA"],
      research_design: "Cross-sectional",
      page_number: 4,
    },
    {
      scale_id: "s-2",
      paper_id: "p-2",
      paper_title: "Exploratory Clinic Survey",
      authors: ["Alan Turing"],
      year: null,
      variable_id: null,
      variable_label: null,
      scale_name: "Brief Burnout Checklist",
      original_authors: null,
      original_year: null,
      item_count: null,
      cronbach_alpha: null,
      composite_reliability: null,
      ave: null,
      response_format: null,
      sample_size: null,
      sample_population: null,
      statistical_methods: [],
      research_design: null,
      page_number: 2,
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
};

describe("ScaleMatrixTab", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      matrixFilters: { ...DEFAULT_MATRIX_FILTERS },
      selectedPaperId: null,
      selectedScaleId: null,
      selectedVariableId: null,
    });
  });

  it("renders real rows and preserves null metrics as '—' without fabricating values", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/matrix/scales")) {
        return Promise.resolve(
          new Response(JSON.stringify(SAMPLE_MATRIX_RESPONSE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.includes("/matrix/methods")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ method: "SEM", count: 1 }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.includes("/graph")) {
        return Promise.resolve(
          new Response(JSON.stringify({ nodes: [], edges: [], gaps: [], contradictions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    renderWithQuery(<ScaleMatrixTab />);

    expect(await screen.findByText("Utrecht Work Engagement Scale")).toBeInTheDocument();
    expect(screen.getByText("Brief Burnout Checklist")).toBeInTheDocument();
    expect(screen.getByText("0.89")).toBeInTheDocument();
    expect(screen.getByText("s. 4")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  it("sends filter parameters and triggers real CSV export", async () => {
    const requestedUrls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/matrix/export")) {
        return Promise.resolve(
          new Response("scale_id,scale_name\ns-1,UWES\n", {
            status: 200,
            headers: { "Content-Type": "text/csv; charset=utf-8" },
          })
        );
      }
      if (url.includes("/matrix/scales")) {
        return Promise.resolve(
          new Response(JSON.stringify(SAMPLE_MATRIX_RESPONSE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.includes("/matrix/methods")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ method: "SEM", count: 1 }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ nodes: [], edges: [], gaps: [], contradictions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();

    renderWithQuery(<ScaleMatrixTab />);
    await screen.findByText("Utrecht Work Engagement Scale");

    fireEvent.click(screen.getByRole("button", { name: "α ≥ 0.80" }));
    await waitFor(() => {
      expect(requestedUrls.some((u) => u.includes("/matrix/scales") && u.includes("min_alpha=0.8"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "CSV İndir" }));
    await waitFor(() => {
      expect(
        requestedUrls.some((u) => u.includes("/matrix/export") && u.includes("format=csv") && u.includes("min_alpha=0.8"))
      ).toBe(true);
    });

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    fetchSpy.mockRestore();
  });

  it("renders structured ApiError banner when backend returns error envelope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/matrix/scales")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error_code: "DATABASE_QUERY_FAILED",
              message: "SQLite sorgusu yürütülemedi.",
              details: {},
              request_id: "req-1",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
      );
    });

    renderWithQuery(<ScaleMatrixTab />);
    expect(await screen.findByText(/DATABASE_QUERY_FAILED: SQLite sorgusu yürütülemedi\./)).toBeInTheDocument();

    fetchSpy.mockRestore();
  });
});
