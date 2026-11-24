import { PaperDetailDrawer } from "@/components/PaperDetailDrawer";
import { PdfReaderPanel } from "@/components/PdfReaderPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { StartupReadinessGate } from "@/components/StartupReadinessGate";
import { TopNavBar } from "@/components/TopNavBar";
import { DraftCriticTab } from "@/features/draft-critic/DraftCriticTab";
import { GraphMapTab } from "@/features/graph-map/GraphMapTab";
import { IngestionSidebar } from "@/features/ingestion/IngestionSidebar";
import { ScaleMatrixTab } from "@/features/scale-matrix/ScaleMatrixTab";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export default function App() {
  const activeTab = useWorkspaceStore((s) => s.activeTab);

  return (
    <StartupReadinessGate>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900">
        <TopNavBar />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <IngestionSidebar />

          <main className="min-w-0 flex-1 overflow-hidden">
            {activeTab === "matrix" && <ScaleMatrixTab />}
            {activeTab === "graph" && <GraphMapTab />}
            {activeTab === "draft" && <DraftCriticTab />}
          </main>

          <PdfReaderPanel />
        </div>

        <PaperDetailDrawer />
        <SettingsModal />
      </div>
    </StartupReadinessGate>
  );
}
