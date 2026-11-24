import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiClient } from "@/api/client";
import { PdfReaderPanel } from "@/components/PdfReaderPanel";
import { AuditDrawer } from "@/features/draft-critic/AuditDrawer";
import { ContradictionComparisonPanel } from "@/features/graph-map/ContradictionComparisonPanel";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { AuditResult, ContradictionCluster, PdfPageRenderResponse } from "@/types/contracts";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAMPLE_RENDER: PdfPageRenderResponse = {
  paper_id: "p-1",
  paper_title: "Remote Work Longitudinal Study",
  page_number: 2,
  page_count: 5,
  width: 612,
  height: 792,
  image_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
  page_text: "Path coefficient was significant in distributed teams.",
  quote_query: "Path coefficient was significant",
  match_found: true,
  highlights: [{ x: 0.12, y: 0.34, w: 0.45, h: 0.03 }],
};

describe("PdfReaderPanel & Grounded PDF Jump Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useWorkspaceStore.setState({
      locale: "en",
      selectedPaperId: null,
      selectedScaleId: null,
      pdfViewer: null,
    });
  });

  it("renders page image, highlight box, extracted text toggle, and page navigation", async () => {
    const spy = vi.spyOn(apiClient, "getPaperPageRender").mockResolvedValue(SAMPLE_RENDER);

    useWorkspaceStore
      .getState()
      .openPdfAtPage("p-1", 2, "Path coefficient was significant", "Remote Work Longitudinal Study");

    renderWithQuery(<PdfReaderPanel />);

    await waitFor(() => {
      expect(screen.getByText("Remote Work Longitudinal Study")).toBeInTheDocument();
      expect(screen.getByText("Page 2 / 5")).toBeInTheDocument();
    });

    expect(spy).toHaveBeenCalledWith("p-1", 2, {
      quote: "Path coefficient was significant",
      zoom: 2,
    });
    expect(screen.getByTestId("pdf-highlight-box")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show extracted page text" }));
    expect(screen.getByText("Path coefficient was significant in distributed teams.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(useWorkspaceStore.getState().pdfViewer?.pageNumber).toBe(3);

    fireEvent.click(screen.getByRole("button", { name: "Close PDF reader" }));
    expect(useWorkspaceStore.getState().pdfViewer).toBeNull();
  });

  it("displays clean PDF_FILE_MISSING and PDF_PAGE_OUT_OF_RANGE error states", async () => {
    vi.spyOn(apiClient, "getPaperPageRender").mockRejectedValueOnce(
      new ApiClientError(404, {
        error_code: "PDF_FILE_MISSING",
        message: "Original PDF file could not be found on disk.",
        details: {},
        request_id: null,
      }),
    );

    useWorkspaceStore.getState().openPdfAtPage("p-missing", 1, null, "Missing PDF Paper");
    const { unmount } = renderWithQuery(<PdfReaderPanel />);

    await waitFor(() => {
      expect(screen.getByText("Original PDF file unavailable")).toBeInTheDocument();
      expect(screen.getByText("Original PDF file could not be found on disk.")).toBeInTheDocument();
    });
    unmount();

    vi.spyOn(apiClient, "getPaperPageRender").mockRejectedValueOnce(
      new ApiClientError(400, {
        error_code: "PDF_PAGE_OUT_OF_RANGE",
        message: "Requested page is outside PDF page range.",
        details: {},
        request_id: null,
      }),
    );

    useWorkspaceStore.getState().openPdfAtPage("p-1", 99, null, "Out of Range Paper");
    renderWithQuery(<PdfReaderPanel />);

    await waitFor(() => {
      expect(screen.getByText("Requested page is out of range")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Jump to page 1" }));
    expect(useWorkspaceStore.getState().pdfViewer?.pageNumber).toBe(1);
  });

  it("opens PdfReaderPanel from ContradictionComparisonPanel and AuditDrawer page buttons", () => {
    const cluster: ContradictionCluster = {
      edge_key: "v1->v2",
      source_variable_id: "v1",
      source_label: "Autonomy",
      target_variable_id: "v2",
      target_label: "Burnout",
      contradiction_score: 0.72,
      opposing_sides: [
        {
          paper_id: "p-contra",
          paper_title: "Autonomy Paradox Study",
          authors: ["Doe, J."],
          year: 2023,
          sample_size: 210,
          statistical_method: "SEM",
          relationship_id: "r-1",
          direction: "positive",
          effect_size: 0.31,
          effect_metric: "β",
          p_value: "< .01",
          page_number: 6,
          quote_snippet: "Autonomy increased exhaustion under ambiguity.",
          grounding_status: "verified",
          grounding_score: 1.0,
          grounding_note: "exact_quote_match",
        },
      ],
    };

    const { unmount } = renderWithQuery(<ContradictionComparisonPanel cluster={cluster} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "p. 6" }));
    expect(useWorkspaceStore.getState().pdfViewer).toEqual({
      paperId: "p-contra",
      pageNumber: 6,
      quote: "Autonomy increased exhaustion under ambiguity.",
      paperTitle: "Autonomy Paradox Study",
    });
    unmount();

    const audit: AuditResult = {
      id: "a-1",
      draft_id: "d-1",
      paragraph_index: 0,
      paragraph_hash: "h-0",
      paragraph_text: "Sample claim.",
      overall_status: "supported",
      style_alignment_score: 0.9,
      evidence_coverage_score: 0.9,
      summary: "Supported",
      model_used: "test",
      created_at: "2026-11-24T10:00:00Z",
      findings: [
        {
          id: "f-1",
          audit_result_id: "a-1",
          finding_type: "supporting_evidence",
          severity: "info",
          excerpt: "Sample claim.",
          explanation: "Supported by paper.",
          suggestion: null,
          related_paper_id: "p-audit",
          related_claim_id: "c-1",
          related_relationship_id: null,
          page_number: 4,
          quote_snippet: "Exact supporting passage on page 4.",
          is_dismissed: false,
          created_at: "2026-11-24T10:00:00Z",
        },
      ],
    };

    renderWithQuery(
      <AuditDrawer
        activeParagraphIndex={0}
        activeParagraphText="Sample claim."
        auditResult={audit}
        isAuditing={false}
        auditError={null}
        onAudit={vi.fn()}
        onDismissFinding={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "p. 4" }));
    expect(useWorkspaceStore.getState().pdfViewer).toEqual({
      paperId: "p-audit",
      pageNumber: 4,
      quote: "Exact supporting passage on page 4.",
      paperTitle: null,
    });
  });
});
