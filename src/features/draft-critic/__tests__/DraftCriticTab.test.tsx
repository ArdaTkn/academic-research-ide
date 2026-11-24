import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DraftCriticTab } from "@/features/draft-critic/DraftCriticTab";
import { findParagraphIndexAtOffset, splitMarkdownParagraphs } from "@/features/draft-critic/paragraphs";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { AuditResult, Draft, StyleProfile } from "@/types/contracts";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAMPLE_DRAFT: Draft = {
  id: "d-1",
  title: "Literature Review",
  content_markdown:
    "Remote work increases productivity across distributed firms.\n\nQuantum compensation reduces burnout.",
  style_profile_id: null,
  created_at: "2026-11-24T10:00:00Z",
  updated_at: "2026-11-24T10:00:00Z",
};

const SAMPLE_AUDIT: AuditResult = {
  id: "a-1",
  draft_id: "d-1",
  paragraph_index: 0,
  paragraph_hash: "hash-0",
  paragraph_text: "Remote work increases productivity across distributed firms.",
  overall_status: "contradicted",
  style_alignment_score: 0.85,
  evidence_coverage_score: 0.5,
  summary: "1 ampirik cümleden 0 desteklendi, 1 çelişki saptandı.",
  model_used: "hybrid-sqlite-lancedb-critic",
  created_at: "2026-11-24T10:05:00Z",
  findings: [
    {
      id: "f-1",
      audit_result_id: "a-1",
      finding_type: "contradiction",
      severity: "error",
      excerpt: "Remote work increases productivity across distributed firms.",
      explanation: "Bu bulgu yerel havuzdaki 'Telecommuting in Manufacturing' (s. 2) çalışmasıyla çelişiyor.",
      suggestion: "Örneklem veya bağlam farkını belirtin.",
      related_paper_id: "p-99",
      related_claim_id: null,
      related_relationship_id: "r-99",
      page_number: 2,
      quote_snippet: "Telecommuting negatively affected productivity.",
      is_dismissed: false,
      created_at: "2026-11-24T10:05:00Z",
    },
  ],
};

describe("paragraphs utilities", () => {
  it("splits markdown paragraphs and maps cursor offsets accurately", () => {
    const md = "First paragraph here.\n\nSecond paragraph has more words.";
    const paras = splitMarkdownParagraphs(md);
    expect(paras).toHaveLength(2);
    expect(paras[0].index).toBe(0);
    expect(paras[1].index).toBe(1);
    expect(findParagraphIndexAtOffset(paras, 5)).toBe(0);
    expect(findParagraphIndexAtOffset(paras, 30)).toBe(1);
  });
});

describe("DraftCriticTab", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeTab: "draft",
      selectedDraftId: null,
      selectedPaperId: null,
      activeParagraphIndex: 0,
    });
  });

  it("audits paragraph, links cited paper to PaperDetailDrawer, and dismisses findings", async () => {
    let dismissed = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/drafts") && (!init?.method || init.method === "GET")) {
        return Promise.resolve(
          new Response(JSON.stringify([SAMPLE_DRAFT]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/style-profiles")) {
        const profiles: StyleProfile[] = [];
        return Promise.resolve(
          new Response(JSON.stringify(profiles), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/drafts/d-1/audits")) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/drafts/d-1/audit") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify(SAMPLE_AUDIT), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/audit-findings/f-1/dismiss") && init?.method === "PATCH") {
        dismissed = true;
        return Promise.resolve(
          new Response(JSON.stringify({ ...SAMPLE_AUDIT.findings[0], is_dismissed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    renderWithQuery(<DraftCriticTab />);

    expect(await screen.findByDisplayValue("Literature Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paragrafı Denetle" }));

    expect(await screen.findByText("Çelişki Saptandı")).toBeInTheDocument();
    expect(screen.getByText("s. 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kaynak Makaleyi İncele" }));
    expect(useWorkspaceStore.getState().selectedPaperId).toBe("p-99");

    fireEvent.click(screen.getByRole("button", { name: "Yoksay" }));
    await waitFor(() => expect(dismissed).toBe(true));

    fetchSpy.mockRestore();
  });

  it("extracts a new style profile via StyleProfileModal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/drafts")) {
        return Promise.resolve(
          new Response(JSON.stringify([SAMPLE_DRAFT]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/drafts/d-1/audits")) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/style-profiles/extract") && init?.method === "POST") {
        const created: StyleProfile = {
          id: "sp-1",
          name: "My APA Style",
          source_files: ["inline_text"],
          tone: "academic-analytical",
          avg_sentence_length: 14.5,
          passive_voice_ratio: 0.25,
          hedging_phrases: ["may"],
          transition_phrases: ["however"],
          citation_style: "APA 7",
          lexical_preferences: { total_words: 29 },
          system_prompt_summary: "Stil: academic-analytical | Ort. cümle uzunluğu: 14.5 kelime",
          is_active: true,
          created_at: "2026-11-24T10:00:00Z",
          updated_at: "2026-11-24T10:00:00Z",
        };
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
      );
    });

    renderWithQuery(<DraftCriticTab />);
    await screen.findByDisplayValue("Literature Review");

    fireEvent.click(screen.getByRole("button", { name: /Stil:/ }));
    expect(await screen.findByText("Akademik Stil Profilleri")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Q1 Makale Üslubum/), { target: { value: "My APA Style" } });
    fireEvent.change(screen.getByPlaceholderText(/1–3 akademik paragrafı/), {
      target: { value: "However, empirical evidence may indicate a positive link." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Profil Çıkar & Aktifleştir" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/style-profiles/extract"),
        expect.objectContaining({ method: "POST" })
      );
    });

    fetchSpy.mockRestore();
  });
});
