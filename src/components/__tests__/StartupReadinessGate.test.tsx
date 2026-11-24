import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetApiBaseUrlCache } from "@/api/client";
import { StartupReadinessGate } from "@/components/StartupReadinessGate";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

const tauriInvokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => tauriInvokeMock(...args),
}));

describe("StartupReadinessGate", () => {
  beforeEach(() => {
    resetApiBaseUrlCache();
    tauriInvokeMock.mockReset();
    useWorkspaceStore.getState().setLocale("en");
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    resetApiBaseUrlCache();
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

  it("completes startup cleanly in Tauri mode when diagnostics returns fresh snapshots per poll (no effect cancel loop)", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriInvokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_backend_url") {
        return Promise.resolve("http://127.0.0.1:18765/api/v1");
      }
      if (cmd === "get_backend_diagnostics") {
        // Fresh object each poll simulating Tauri IPC response
        return Promise.resolve({
          base_url: "http://127.0.0.1:18765/api/v1",
          mode: "bundled_sidecar",
          status: "running",
          last_error: null,
          data_dir: "/tmp/ide-data",
          logs: ["[host] Launching backend on 127.0.0.1:18765"],
          pid: 1234,
        });
      }
      return Promise.resolve(null);
    });

    let healthCalls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      expect(String(input)).toBe("http://127.0.0.1:18765/api/v1/health");
      healthCalls += 1;
      if (healthCalls === 1) {
        return Promise.reject(new TypeError("Sidecar still unpacking"));
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
      <StartupReadinessGate pollIntervalMs={20} timeoutMs={3000}>
        <div>Tauri Bundled App Ready</div>
      </StartupReadinessGate>
    );

    await waitFor(() => {
      expect(screen.getByText("Tauri Bundled App Ready")).toBeInTheDocument();
    });
    expect(healthCalls).toBeGreaterThanOrEqual(2);

    fetchSpy.mockRestore();
  });

  it("immediately surfaces stderr logs when sidecar exits prematurely instead of spinning until timeout", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriInvokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_backend_diagnostics") {
        return Promise.resolve({
          base_url: "http://127.0.0.1:18765/api/v1",
          mode: "bundled_sidecar",
          status: "failed",
          last_error: "Backend process exited unexpectedly with status: exit status: 1",
          data_dir: "/tmp/ide-data",
          logs: ["[stderr] ImportError: missing module"],
          pid: null,
        });
      }
      return Promise.resolve(null);
    });

    render(
      <StartupReadinessGate pollIntervalMs={20} timeoutMs={45000}>
        <div>Unreachable</div>
      </StartupReadinessGate>
    );

    expect(
      await screen.findByText("Backend process exited unexpectedly with status: exit status: 1")
    ).toBeInTheDocument();
    expect(screen.getByText(/ImportError: missing module/)).toBeInTheDocument();
  });
});
