import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopNavBar } from "@/components/TopNavBar";
import { ScaleMatrixTab } from "@/features/scale-matrix/ScaleMatrixTab";
import { en } from "@/i18n/en";
import { tr } from "@/i18n/tr";
import { translate } from "@/i18n";
import { DEFAULT_MATRIX_FILTERS, useWorkspaceStore } from "@/stores/useWorkspaceStore";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("i18n dictionaries & live EN/TR toggle", () => {
  beforeEach(() => {
    try {
      window.localStorage?.removeItem?.("academic_research_ide.locale");
    } catch {
      // Ignore in Node environments without localStorage file
    }
    useWorkspaceStore.getState().setLocale("en");
    useWorkspaceStore.setState({
      activeTab: "matrix",
      matrixFilters: { ...DEFAULT_MATRIX_FILTERS },
    });
  });

  it("maintains exact 1:1 key parity and placeholder parity between English and Turkish", () => {
    const enKeys = Object.keys(en).sort();
    const trKeys = Object.keys(tr).sort();
    expect(trKeys).toEqual(enKeys);

    for (const key of enKeys) {
      const k = key as keyof typeof en;
      const enPlaceholders = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const trPlaceholders = [...tr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(trPlaceholders, `Placeholder mismatch for key ${k}`).toEqual(enPlaceholders);
    }

    expect(translate("en", "common.pageShort", { page: 5 })).toBe("p. 5");
    expect(translate("tr", "common.pageShort", { page: 5 })).toBe("s. 5");
  });

  it("switches TopNavBar and active tab copy immediately between EN and TR without reload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("/health")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ok",
              version: "0.1.0",
              sqlite_ok: true,
              lancedb_ok: true,
              active_llm_provider: "ollama",
              active_llm_model: "qwen2.5:14b",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("/config")) {
        let patchedLocale = "en";
        if (init?.method === "PATCH" && init.body) {
          try {
            const parsed = JSON.parse(String(init.body)) as { ui_locale?: string };
            if (parsed.ui_locale) patchedLocale = parsed.ui_locale;
          } catch {
            // fallback
          }
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              llm_provider: "ollama",
              llm_model: "qwen2.5:14b",
              llm_base_url: "http://127.0.0.1:11434/v1",
              embedding_provider: "openai_compatible",
              embedding_model: "nomic-embed-text",
              embedding_base_url: null,
              embedding_dim: 768,
              api_key_configured: false,
              ui_locale: patchedLocale,
              data_dir: "data",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("/matrix/scales")) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }), {
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
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
      );
    });

    renderWithQuery(
      <>
        <TopNavBar />
        <ScaleMatrixTab />
      </>
    );

    expect(screen.getByRole("heading", { name: "Scale & Method Matrix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Model Settings" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "tr" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Ölçek & Yöntem Matrisi" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Model Ayarları" })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().locale).toBe("tr");
    expect(document.documentElement.lang).toBe("tr");

    fireEvent.click(screen.getByRole("button", { name: "en" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Scale & Method Matrix" })).toBeInTheDocument();
    });

    // Default theme is dark; switching to light and back updates document.documentElement.classList
    expect(useWorkspaceStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Switch to Light Mode" }));
    expect(useWorkspaceStore.getState().theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Switch to Dark Mode" }));
    expect(useWorkspaceStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fetchSpy.mockRestore();
  });
});
