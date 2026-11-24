import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  FileText,
  GitFork,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Table2,
} from "lucide-react";
import { useEffect } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { useI18n, type TranslationKey } from "@/i18n";
import { useWorkspaceStore, type WorkspaceTabId } from "@/stores/useWorkspaceStore";
import type { UiLocale } from "@/types/contracts";

const TABS: Array<{ id: WorkspaceTabId; labelKey: TranslationKey; icon: typeof Table2 }> = [
  { id: "graph", labelKey: "nav.tab.graph", icon: GitFork },
  { id: "matrix", labelKey: "nav.tab.matrix", icon: Table2 },
  { id: "draft", labelKey: "nav.tab.draft", icon: FileText },
];

export function TopNavBar() {
  const { t, locale, setLocale } = useI18n();
  const queryClient = useQueryClient();
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const isSidebarCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const setSidebarCollapsed = useWorkspaceStore((s) => s.setSidebarCollapsed);
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => apiClient.getHealth(),
    refetchInterval: 30_000,
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => apiClient.getConfig(),
    staleTime: 60_000,
  });

  // İlk açılışta localStorage seçimi yoksa backend config'teki ui_locale ile hizala
  useEffect(() => {
    if (configQuery.data?.ui_locale) {
      let saved: string | null = null;
      if (typeof window !== "undefined") {
        try {
          saved = window.localStorage?.getItem?.("academic_research_ide.locale") ?? null;
        } catch {
          saved = null;
        }
      }
      if (!saved && configQuery.data.ui_locale !== locale) {
        setLocale(configQuery.data.ui_locale);
      }
    }
  }, [configQuery.data?.ui_locale, locale, setLocale]);

  const handleToggleLocale = (next: UiLocale) => {
    if (next === locale) return;
    setLocale(next);
    void apiClient
      .patchConfig({ ui_locale: next })
      .then((updated) => {
        queryClient.setQueryData(["config"], updated);
      })
      .catch(() => {
        // Offline veya test ortamında sessizce yerel tercihi koru
      });
    void queryClient.invalidateQueries({ queryKey: ["graph"] });
    void queryClient.invalidateQueries({ queryKey: ["draft-audits"] });
  };

  const health = healthQuery.data;
  const isHealthy = health?.status === "ok" && health.sqlite_ok && health.lancedb_ok;
  const errorMsg =
    healthQuery.error instanceof ApiClientError
      ? `${healthQuery.error.error_code}: ${healthQuery.error.message}`
      : healthQuery.isError
        ? t("nav.backendOffline")
        : null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title={isSidebarCollapsed ? t("nav.toggleSidebarOpen") : t("nav.toggleSidebarClose")}
        >
          {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-2 pr-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <BookOpenCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none text-slate-900">{t("app.title")}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{t("app.subtitle")}</div>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" aria-label={t("nav.modulesAria")}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-white text-indigo-700 shadow-xs"
                    : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        {healthQuery.isLoading ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
            <Activity className="h-3.5 w-3.5 animate-pulse text-slate-400" />
            {t("nav.connecting")}
          </span>
        ) : isHealthy && health ? (
          <div
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-800"
            title={t("nav.backendHealthyTooltip", { provider: health.active_llm_provider })}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium">{t("nav.backendReady")}</span>
            <span className="text-emerald-600">·</span>
            <span className="font-mono text-[11px]">{health.active_llm_model}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void healthQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
            title={errorMsg ?? t("nav.retryConnection")}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
            <span>{errorMsg ?? t("nav.backendOffline")}</span>
            <RefreshCw className="h-3 w-3" />
          </button>
        )}

        {/* EN / TR Dil Seçici */}
        <div
          className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold"
          title={t("nav.switchLanguageTooltip")}
          role="group"
          aria-label={t("settings.uiLanguage")}
        >
          <Languages className="mx-1.5 h-3.5 w-3.5 text-slate-400" />
          {(["en", "tr"] as const).map((code) => {
            const active = locale === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleToggleLocale(code)}
                className={`rounded-md px-2 py-1 uppercase transition ${
                  active ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {code}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>{t("nav.modelSettings")}</span>
        </button>
      </div>
    </header>
  );
}
