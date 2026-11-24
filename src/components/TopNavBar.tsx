import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  FileText,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Table2,
} from "lucide-react";
import { apiClient, ApiClientError } from "@/api/client";
import { useWorkspaceStore, type WorkspaceTabId } from "@/stores/useWorkspaceStore";

const TABS: Array<{ id: WorkspaceTabId; label: string; badge?: string; icon: typeof Table2 }> = [
  { id: "graph", label: "Kavram & Çelişki Haritası", icon: GitFork },
  { id: "matrix", label: "Ölçek & Yöntem Matrisi", icon: Table2 },
  { id: "draft", label: "Taslak & Kanıt Denetçisi", icon: FileText },
];

export function TopNavBar() {
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

  const health = healthQuery.data;
  const isHealthy = health?.status === "ok" && health.sqlite_ok && health.lancedb_ok;
  const errorMsg =
    healthQuery.error instanceof ApiClientError
      ? `${healthQuery.error.error_code}: ${healthQuery.error.message}`
      : healthQuery.isError
        ? "Arka uç çevrimdışı"
        : null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title={isSidebarCollapsed ? "Makale Havuzunu Aç" : "Makale Havuzunu Daralt"}
        >
          {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-2 pr-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <BookOpenCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none text-slate-900">Academic Research IDE</div>
            <div className="mt-0.5 text-[11px] text-slate-500">Yerel Literatür & Metodoloji Stüdyosu</div>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" aria-label="Ana Modüller">
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
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        {healthQuery.isLoading ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
            <Activity className="h-3.5 w-3.5 animate-pulse text-slate-400" />
            Bağlanıyor...
          </span>
        ) : isHealthy && health ? (
          <div
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-800"
            title={`SQLite & LanceDB hazır · Sağlayıcı: ${health.active_llm_provider}`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium">FastAPI Hazır</span>
            <span className="text-emerald-600">·</span>
            <span className="font-mono text-[11px]">{health.active_llm_model}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void healthQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
            title={errorMsg ?? "Bağlantıyı yeniden dene"}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
            <span>{errorMsg ?? "Arka Uç Çevrimdışı"}</span>
            <RefreshCw className="h-3 w-3" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>Model Ayarları</span>
        </button>
      </div>
    </header>
  );
}
