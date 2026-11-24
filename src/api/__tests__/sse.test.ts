import { describe, expect, it, vi } from "vitest";
import { subscribeToJob } from "@/api/sse";
import type { IngestionJob } from "@/types/contracts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: Record<string, Array<(event: MessageEvent<string>) => void>> = {};
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(listener);
  }

  emitStatus(job: IngestionJob) {
    const event = { data: JSON.stringify(job) } as MessageEvent<string>;
    for (const fn of this.listeners.status ?? []) {
      fn(event);
    }
  }

  triggerError() {
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
  }
}

describe("subscribeToJob SSE resilience", () => {
  it("streams status events and resolves cleanly on terminal state", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    const updates: IngestionJob[] = [];
    const completed: IngestionJob[] = [];

    const unsub = subscribeToJob("job-1", {
      onUpdate: (j) => updates.push(j),
      onComplete: (j) => completed.push(j),
      onError: () => {
        throw new Error("Unexpected error");
      },
    });

    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const es = FakeEventSource.instances[0];
    expect(es.url).toContain("/jobs/job-1/stream");

    es.emitStatus({
      id: "job-1",
      paper_id: "p-1",
      file_path: "paper.pdf",
      status: "parsing_llm",
      progress_percent: 45,
      current_stage_message: "Parsing",
      error_detail: null,
      started_at: "2026-11-24T12:00:00Z",
      completed_at: null,
      created_at: "2026-11-24T12:00:00Z",
    });

    es.emitStatus({
      id: "job-1",
      paper_id: "p-1",
      file_path: "paper.pdf",
      status: "completed",
      progress_percent: 100,
      current_stage_message: "Done",
      error_detail: null,
      started_at: "2026-11-24T12:00:00Z",
      completed_at: "2026-11-24T12:00:10Z",
      created_at: "2026-11-24T12:00:00Z",
    });

    expect(updates).toHaveLength(2);
    expect(completed).toHaveLength(1);
    expect(es.closed).toBe(true);

    unsub();
    vi.unstubAllGlobals();
  });

  it("falls back to HTTP job polling when SSE reconnects are exhausted", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "job-2",
          paper_id: "p-2",
          file_path: "paper2.pdf",
          status: "completed",
          progress_percent: 100,
          current_stage_message: "Done",
          error_detail: null,
          started_at: "2026-11-24T12:00:00Z",
          completed_at: "2026-11-24T12:00:05Z",
          created_at: "2026-11-24T12:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const completed: IngestionJob[] = [];
    const unsub = subscribeToJob(
      "job-2",
      {
        onUpdate: () => {},
        onComplete: (j) => completed.push(j),
        onError: () => {},
      },
      { maxReconnects: 1, baseDelayMs: 10, pollIntervalMs: 50 }
    );

    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    FakeEventSource.instances[0].triggerError();

    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
    FakeEventSource.instances[1].triggerError();

    await vi.waitFor(() => expect(completed).toHaveLength(1));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/jobs\/job-2$/),
      undefined
    );

    unsub();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
