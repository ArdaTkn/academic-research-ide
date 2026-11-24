import { apiClient, resolveApiBaseUrl } from "@/api/client";
import type { IngestionJob } from "@/types/contracts";

export interface JobSubscriptionCallbacks {
  onUpdate: (job: IngestionJob) => void;
  onComplete: (job: IngestionJob) => void;
  onError: (err: Error) => void;
}

export interface JobSubscriptionOptions {
  maxReconnects?: number;
  baseDelayMs?: number;
  pollIntervalMs?: number;
}

const TERMINAL_STATUSES = new Set<IngestionJob["status"]>(["completed", "failed"]);

/**
 * Subscribe to live FastAPI SSE `/jobs/{id}/stream` with bounded exponential-backoff
 * reconnection and HTTP polling fallback so terminal states are never missed.
 */
export function subscribeToJob(
  jobId: string,
  callbacks: JobSubscriptionCallbacks,
  options: JobSubscriptionOptions = {}
): () => void {
  const maxReconnects = options.maxReconnects ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;

  let closed = false;
  let reconnectCount = 0;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    closed = true;
    if (source) {
      source.close();
      source = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const handleJobPayload = (job: IngestionJob) => {
    if (closed) return;
    callbacks.onUpdate(job);
    if (TERMINAL_STATUSES.has(job.status)) {
      cleanup();
      callbacks.onComplete(job);
    }
  };

  const startPollingFallback = () => {
    if (closed || pollTimer) return;
    const pollOnce = async () => {
      if (closed) return;
      try {
        const job = await apiClient.getJob(jobId);
        handleJobPayload(job);
      } catch (err) {
        if (!closed) {
          cleanup();
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };
    void pollOnce();
    pollTimer = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
  };

  const connect = async () => {
    if (closed) return;
    if (typeof EventSource === "undefined") {
      startPollingFallback();
      return;
    }

    try {
      const baseUrl = await resolveApiBaseUrl();
      if (closed) return;

      const streamUrl = `${baseUrl}/jobs/${encodeURIComponent(jobId)}/stream`;
      source = new EventSource(streamUrl);

      source.addEventListener("status", (event: MessageEvent<string>) => {
        try {
          const job = JSON.parse(event.data) as IngestionJob;
          reconnectCount = 0;
          handleJobPayload(job);
        } catch (err) {
          callbacks.onError(err instanceof Error ? err : new Error("SSE verisi ayrıştırılamadı."));
        }
      });

      source.onerror = () => {
        if (closed) return;
        source?.close();
        source = null;

        if (reconnectCount < maxReconnects) {
          const delay = baseDelayMs * Math.pow(2, reconnectCount);
          reconnectCount += 1;
          reconnectTimer = setTimeout(() => {
            void connect();
          }, delay);
        } else {
          startPollingFallback();
        }
      };
    } catch {
      startPollingFallback();
    }
  };

  void connect();
  return cleanup;
}
