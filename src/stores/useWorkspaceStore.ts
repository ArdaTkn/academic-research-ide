import { create } from "zustand";
import type {
  IngestionJob,
  RelationshipDirection,
  ScaleMatrixFilter,
  UiLocale,
} from "@/types/contracts";

export const LOCALE_STORAGE_KEY = "academic_research_ide.locale";

function getInitialLocale(): UiLocale {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === "tr" || saved === "en") return saved;
    } catch {
      // Ignore storage access restrictions
    }
  }
  return "en";
}

function persistLocale(locale: UiLocale): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage access restrictions
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }
}

export type WorkspaceTabId = "graph" | "matrix" | "draft";
export type GraphInspectorTab = "contradictions" | "gaps" | "node";

export interface GraphFilterState {
  min_paper_count: number;
  direction: RelationshipDirection | null;
  year_from: number | null;
  year_to: number | null;
  showGaps: boolean;
  onlyContradictions: boolean;
  layoutDirection: "LR" | "TB";
}

export const DEFAULT_GRAPH_FILTERS: GraphFilterState = {
  min_paper_count: 1,
  direction: null,
  year_from: null,
  year_to: null,
  showGaps: true,
  onlyContradictions: false,
  layoutDirection: "LR",
};

export const DEFAULT_MATRIX_FILTERS: ScaleMatrixFilter = {
  search: "",
  variable_id: null,
  min_alpha: null,
  max_alpha: null,
  min_sample_size: null,
  statistical_method: null,
  year_from: null,
  year_to: null,
  sort_by: "year",
  sort_dir: "desc",
  limit: 25,
  offset: 0,
};

interface WorkspaceState {
  locale: UiLocale;
  activeTab: WorkspaceTabId;
  selectedPaperId: string | null;
  selectedVariableId: string | null;
  selectedScaleId: string | null;
  selectedDraftId: string | null;
  selectedEdgeKey: string | null;
  selectedGapPair: [string, string] | null;
  activeParagraphIndex: number;
  graphInspectorTab: GraphInspectorTab;
  graphFilters: GraphFilterState;
  activeJobs: Record<string, IngestionJob>;
  matrixFilters: ScaleMatrixFilter;
  isSettingsOpen: boolean;
  isSidebarCollapsed: boolean;

  setLocale: (locale: UiLocale) => void;
  setActiveTab: (tab: WorkspaceTabId) => void;
  setSelectedPaperId: (paperId: string | null) => void;
  setSelectedVariableId: (variableId: string | null) => void;
  setSelectedScaleId: (scaleId: string | null) => void;
  setSelectedDraftId: (draftId: string | null) => void;
  setActiveParagraphIndex: (index: number) => void;
  setSelectedEdgeKey: (edgeKey: string | null) => void;
  setSelectedGapPair: (pair: [string, string] | null) => void;
  setGraphInspectorTab: (tab: GraphInspectorTab) => void;
  setGraphFilters: (patch: Partial<GraphFilterState>) => void;
  resetGraphFilters: () => void;
  upsertJob: (job: IngestionJob) => void;
  dismissJob: (jobId: string) => void;
  setMatrixFilters: (patch: Partial<ScaleMatrixFilter>) => void;
  resetMatrixFilters: () => void;
  focusVariableInMatrix: (variableId: string | null) => void;
  focusVariableInGraph: (variableId: string | null) => void;
  focusPaperDetail: (paperId: string | null, scaleId?: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  locale: getInitialLocale(),
  activeTab: "matrix",
  selectedPaperId: null,
  selectedVariableId: null,
  selectedScaleId: null,
  selectedDraftId: null,
  selectedEdgeKey: null,
  selectedGapPair: null,
  activeParagraphIndex: 0,
  graphInspectorTab: "contradictions",
  graphFilters: { ...DEFAULT_GRAPH_FILTERS },
  activeJobs: {},
  matrixFilters: { ...DEFAULT_MATRIX_FILTERS },
  isSettingsOpen: false,
  isSidebarCollapsed: false,

  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedPaperId: (selectedPaperId) => set({ selectedPaperId }),
  setSelectedVariableId: (selectedVariableId) => set({ selectedVariableId }),
  setSelectedScaleId: (selectedScaleId) => set({ selectedScaleId }),
  setSelectedDraftId: (selectedDraftId) => set({ selectedDraftId, activeParagraphIndex: 0 }),
  setActiveParagraphIndex: (activeParagraphIndex) => set({ activeParagraphIndex }),
  setSelectedEdgeKey: (selectedEdgeKey) => set({ selectedEdgeKey }),
  setSelectedGapPair: (selectedGapPair) => set({ selectedGapPair }),
  setGraphInspectorTab: (graphInspectorTab) => set({ graphInspectorTab }),

  setGraphFilters: (patch) =>
    set((state) => ({
      graphFilters: { ...state.graphFilters, ...patch },
    })),

  resetGraphFilters: () =>
    set({
      graphFilters: { ...DEFAULT_GRAPH_FILTERS },
      selectedEdgeKey: null,
      selectedGapPair: null,
    }),

  upsertJob: (job) =>
    set((state) => ({
      activeJobs: { ...state.activeJobs, [job.id]: job },
    })),

  dismissJob: (jobId) =>
    set((state) => {
      const next = { ...state.activeJobs };
      delete next[jobId];
      return { activeJobs: next };
    }),

  setMatrixFilters: (patch) =>
    set((state) => {
      const resetOffset = patch.offset === undefined ? 0 : patch.offset;
      return {
        matrixFilters: {
          ...state.matrixFilters,
          ...patch,
          offset: resetOffset,
        },
      };
    }),

  resetMatrixFilters: () =>
    set({
      matrixFilters: { ...DEFAULT_MATRIX_FILTERS },
      selectedVariableId: null,
    }),

  focusVariableInMatrix: (variableId) =>
    set((state) => ({
      selectedVariableId: variableId,
      activeTab: "matrix",
      matrixFilters: {
        ...state.matrixFilters,
        variable_id: variableId,
        offset: 0,
      },
    })),

  focusVariableInGraph: (variableId) =>
    set({
      selectedVariableId: variableId,
      activeTab: "graph",
      graphInspectorTab: "node",
    }),

  focusPaperDetail: (paperId, scaleId = null) =>
    set({
      selectedPaperId: paperId,
      selectedScaleId: scaleId,
    }),

  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setSidebarCollapsed: (isSidebarCollapsed) => set({ isSidebarCollapsed }),
}));
