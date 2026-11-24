import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiClient, getBackendDiagnostics, restartBackend } from "@/api/client";
import { useI18n } from "@/i18n";
import type { BackendDiagnostics } from "@/types/contracts";

interface StartupReadinessGateProps {
  children: ReactNode;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export function StartupReadinessGate({
  children,
  pollIntervalMs = 400,
  timeoutMs = 45_000,
}: StartupReadinessGateProps) {
  const { t, locale, setLocale } = useI18n();
  const [phase, setPhase] = useState<"checking" | "ready" | "error">("checking");
  const [errorKind, setErrorKind] = useState<"timeout" | "custom" | null>(null);
  const [customErrorMessage, setCustomErrorMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<BackendDiagnostics | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const startedAtRef = useRef<number>(Date.now());
  const lastDiagKeyRef = useRef<string>("");

  const syncDiagnostics = useCallback((diag: BackendDiagnostics | null) => {
    if (!diag) return;
    const key = `${diag.status}|${diag.pid ?? ""}|${diag.base_url}|${diag.last_error ?? ""}|${diag.logs.length}`;
    if (key !== lastDiagKeyRef.current) {
      lastDiagKeyRef.current = key;
      setDiagnostics(diag);
    }
  }, []);

  const runReadinessLoop = useCallback(() => {
    startedAtRef.current = Date.now();
    lastDiagKeyRef.current = "";
    setPhase("checking");
    setErrorKind(null);
    setCustomErrorMessage(null);
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const failImmediate = (message: string | null) => {
      if (cancelled) return;
      if (message) {
        setErrorKind("custom");
        setCustomErrorMessage(message);
      } else {
        setErrorKind("timeout");
        setCustomErrorMessage(null);
      }
      setShowLogs(true);
      setPhase("error");
    };

    const probeOnce = async () => {
      if (cancelled) return;

      const diag = await getBackendDiagnostics();
      if (cancelled) return;
      syncDiagnostics(diag);

      if (diag && diag.status === "failed") {
        failImmediate(diag.last_error ?? null);
        return;
      }

      try {
        const health = await apiClient.getHealth();
        if (cancelled) return;
        if (health.status === "ok" && health.sqlite_ok && health.lancedb_ok) {
          setPhase("ready");
          return;
        }
      } catch (err) {
        if (cancelled) return;
        const freshDiag = await getBackendDiagnostics();
        if (cancelled) return;
        syncDiagnostics(freshDiag);

        if (freshDiag && freshDiag.status === "failed") {
          failImmediate(freshDiag.last_error ?? null);
          return;
        }

        const elapsed = Date.now() - startedAtRef.current;
        if (elapsed >= timeoutMs) {
          const msg =
            freshDiag?.last_error ??
            (err instanceof Error && err.message ? err.message : null);
          failImmediate(msg);
          return;
        }
      }

      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed >= timeoutMs) {
        failImmediate(null);
        return;
      }

      timer = setTimeout(() => {
        void probeOnce();
      }, pollIntervalMs);
    };

    void probeOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt, pollIntervalMs, timeoutMs, syncDiagnostics]);

  const handleRetry = async () => {
    setIsRestarting(true);
    try {
      const fresh = await restartBackend();
      if (fresh) {
        syncDiagnostics(fresh);
      }
    } finally {
      setIsRestarting(false);
      runReadinessLoop();
    }
  };

  if (phase === "ready") {
    return <>{children}</>;
  }

  const sidecarSpawned = diagnostics === null || diagnostics.pid !== null || diagnostics.mode === "external";
  const storageBooted =
    diagnostics !== null &&
    diagnostics.logs.some((line) => line.includes("Application startup complete"));
  const displayedError =
    errorKind === "custom" && customErrorMessage ? customErrorMessage : t("startup.errorTimeout");

  return (
    <div className="flex min-h-screen w-screen flex-col items-center justify-center bg-slate-50 p-6 text-slate-900">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
              <BookOpenCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">{t("startup.title")}</h1>
              <p className="mt-0.5 text-xs text-slate-500">{t("startup.subtitle")}</p>
            </div>
          </div>

          <div
            className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold"
            role="group"
            aria-label={t("settings.uiLanguage")}
          >
            {(["en", "tr"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                className={`rounded-md px-2 py-0.5 uppercase transition ${
                  locale === code ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        {phase === "checking" ? (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-2.5 text-xs font-medium text-indigo-900">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
              <span>{t("startup.waiting")}</span>
            </div>

            <ul className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs text-slate-700">
              <li className="flex items-center gap-2">
                {sidecarSpawned ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                )}
                <span>{t("startup.stage.sidecar")}</span>
              </li>
              <li className="flex items-center gap-2">
                {storageBooted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                )}
                <span>{t("startup.stage.storage")}</span>
              </li>
              <li className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                <span>{t("startup.stage.health")}</span>
              </li>
            </ul>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{t("startup.errorTitle")}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-rose-800">{displayedError}</p>
            </div>

            {diagnostics && (
              <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <div>
                  <span className="font-semibold text-slate-700">{t("startup.modeLabel")}</span>{" "}
                  <span className="font-mono">{diagnostics.mode}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-700">{t("startup.endpointLabel")}</span>{" "}
                  <span className="font-mono">{diagnostics.base_url}</span>
                </div>
                <div className="break-all">
                  <span className="font-semibold text-slate-700">{t("startup.dataDirLabel")}</span>{" "}
                  <span className="font-mono">{diagnostics.data_dir}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowLogs((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Terminal className="h-3.5 w-3.5 text-slate-500" />
                <span>
                  {showLogs
                    ? t("startup.logsToggleHide")
                    : t("startup.logsToggleShow", { count: diagnostics?.logs.length ?? 0 })}
                </span>
                {showLogs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                disabled={isRestarting}
                onClick={() => void handleRetry()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-indigo-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRestarting ? "animate-spin" : ""}`} />
                <span>{isRestarting ? t("startup.retrying") : t("startup.retry")}</span>
              </button>
            </div>

            {showLogs && (
              <pre className="max-h-48 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                {diagnostics && diagnostics.logs.length > 0
                  ? diagnostics.logs.join("\n")
                  : t("startup.noLogs")}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
