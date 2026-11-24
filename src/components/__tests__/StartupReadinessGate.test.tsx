import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartupReadinessGate } from "@/components/StartupReadinessGate";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

describe("StartupReadinessGate", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setLocale("en");
  });

  it("displays startup readiness screen while backend is warming up and reveals IDE once /health is ok", async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TypeError("Connection refused"));
      }
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
    });

    render(
      <StartupReadinessGate pollIntervalMs={20} timeoutMs={2000}>
        <div>Workspace Ready Shell</div>
      </StartupReadinessGate>
    );

    expect(screen.getByText("Starting Academic Research IDE")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Workspace Ready Shell")).toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  });

  it("shows bilingual diagnostics and recovers via retry after startup timeout", async () => {
    let shouldFail = true;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      if (shouldFail) {
        return Promise.reject(new TypeError("Backend offline"));
      }
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
    });

    render(
      <StartupReadinessGate pollIntervalMs={15} timeoutMs={40}>
        <div>Recovered Workspace</div>
      </StartupReadinessGate>
    );

    await waitFor(() => {
      expect(screen.getByText("Local Backend Failed to Become Ready")).toBeInTheDocument();
    });

    // Live EN -> TR switch on error gate
    fireEvent.click(screen.getByRole("button", { name: "tr" }));
    expect(screen.getByText("Yerel Arka Uç Hazır Duruma Geçemedi")).toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Yeniden Dene ve Arka Ucu Başlat" }));

    await waitFor(() => {
      expect(screen.getByText("Recovered Workspace")).toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  });
});
