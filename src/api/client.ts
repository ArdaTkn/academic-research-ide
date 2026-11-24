import type {
  ApiError,
  AuditFinding,
  AuditParagraphRequest,
  AuditResult,
  BackendDiagnostics,
  ConfigPatchRequest,
  ConfigResponse,
  ContradictionCluster,
  DeleteDraftResponse,
  DeletePaperResponse,
  Draft,
  DraftCreateRequest,
  DraftUpdateRequest,
  GraphResponse,
  HealthResponse,
  IngestionJob,
  IngestionStatus,
  MethodCountItem,
  PaginatedResponse,
  Paper,
  PaperDetailResponse,
  PdfPageRenderResponse,
  RelationshipDirection,
  ResearchGap,
  ScaleMatrixFilter,
  ScaleMatrixResponse,
  StyleExtractRequest,
  StyleProfile,
  Variable,
  VariableMergeRequest,
} from "@/types/contracts";
import { translate } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export interface GraphFilterParams {
  min_paper_count?: number;
  direction?: RelationshipDirection | null;
  year_from?: number | null;
  year_to?: number | null;
  variable_ids?: string[];
}

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8765/api/v1";

let cachedBaseUrl: string | null = null;

export class ApiClientError extends Error {
  readonly status: number;
  readonly error_code: string;
  readonly details: Record<string, unknown>;
  readonly request_id: string | null;

  constructor(status: number, payload: ApiError) {
    super(payload.message);
    this.name = "ApiClientError";
    this.status = status;
    this.error_code = payload.error_code;
    this.details = payload.details ?? {};
    this.request_id = payload.request_id ?? null;
  }
}

export function resetApiBaseUrlCache(): void {
  cachedBaseUrl = null;
}

export async function resolveApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const url = await invoke<string>("get_backend_url");
      if (url && typeof url === "string") {
        cachedBaseUrl = url.replace(/\/+$/, "");
        return cachedBaseUrl;
      }
    } catch {
      // Fallback to env/default if running outside Tauri runtime
    }
  }

  const envUrl = import.meta.env.VITE_API_BASE_URL;
  const resolved = (envUrl && envUrl.trim() ? envUrl.trim() : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  cachedBaseUrl = resolved;
  return resolved;
}

export async function getBackendDiagnostics(): Promise<BackendDiagnostics | null> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<BackendDiagnostics>("get_backend_diagnostics");
    } catch {
      return null;
    }
  }
  return null;
}

export async function restartBackend(): Promise<BackendDiagnostics | null> {
  resetApiBaseUrlCache();
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const diag = await invoke<BackendDiagnostics>("restart_backend");
      if (diag?.base_url) {
        cachedBaseUrl = diag.base_url.replace(/\/+$/, "");
      }
      return diag;
    } catch {
      return null;
    }
  }
  return null;
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = (await response.json()) as Partial<ApiError>;
      if (typeof data.error_code === "string" && typeof data.message === "string") {
        return new ApiClientError(response.status, {
          error_code: data.error_code,
          message: data.message,
          details: data.details ?? {},
          request_id: data.request_id ?? null,
        });
      }
    } catch {
      // Fall through to generic HTTP error
    }
  }
  return new ApiClientError(response.status, {
    error_code: `HTTP_${response.status}`,
    message: response.statusText || translate(useWorkspaceStore.getState().locale, "err.httpGeneric"),
    details: {},
    request_id: null,
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await resolveApiBaseUrl();
  const locale = useWorkspaceStore.getState().locale;
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", locale);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch (err) {
    throw new ApiClientError(0, {
      error_code: "BACKEND_UNREACHABLE",
      message: translate(locale, "err.backendUnreachable"),
      details: { cause: err instanceof Error ? err.message : String(err), base_url: baseUrl },
      request_id: null,
    });
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return (await response.json()) as T;
}

export function buildMatrixQueryParams(filters: ScaleMatrixFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search && filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.variable_id) params.set("variable_id", filters.variable_id);
  if (filters.min_alpha !== undefined && filters.min_alpha !== null) {
    params.set("min_alpha", String(filters.min_alpha));
  }
  if (filters.max_alpha !== undefined && filters.max_alpha !== null) {
    params.set("max_alpha", String(filters.max_alpha));
  }
  if (filters.min_sample_size !== undefined && filters.min_sample_size !== null) {
    params.set("min_sample_size", String(filters.min_sample_size));
  }
  if (filters.statistical_method && filters.statistical_method.trim()) {
    params.set("statistical_method", filters.statistical_method.trim());
  }
  if (filters.year_from !== undefined && filters.year_from !== null) {
    params.set("year_from", String(filters.year_from));
  }
  if (filters.year_to !== undefined && filters.year_to !== null) {
    params.set("year_to", String(filters.year_to));
  }
  if (filters.grounding_status) {
    params.set("grounding_status", filters.grounding_status);
  }
  if (filters.sort_by) params.set("sort_by", filters.sort_by);
  if (filters.sort_dir) params.set("sort_dir", filters.sort_dir);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  return params;
}

export const apiClient = {
  getHealth(): Promise<HealthResponse> {
    return requestJson<HealthResponse>("/health");
  },

  getConfig(): Promise<ConfigResponse> {
    return requestJson<ConfigResponse>("/config");
  },

  patchConfig(patch: ConfigPatchRequest): Promise<ConfigResponse> {
    return requestJson<ConfigResponse>("/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  ingestFiles(files: File[]): Promise<IngestionJob[]> {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    return requestJson<IngestionJob[]>("/papers/ingest", {
      method: "POST",
      body: formData,
    });
  },

  ingestPaths(file_paths: string[]): Promise<IngestionJob[]> {
    return requestJson<IngestionJob[]>("/papers/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_paths }),
    });
  },

  getJob(job_id: string): Promise<IngestionJob> {
    return requestJson<IngestionJob>(`/jobs/${encodeURIComponent(job_id)}`);
  },

  getPapers(params?: {
    status?: IngestionStatus;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Paper>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.search && params.search.trim()) qs.set("search", params.search.trim());
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestJson<PaginatedResponse<Paper>>(`/papers${suffix}`);
  },

  getPaperDetail(paper_id: string): Promise<PaperDetailResponse> {
    return requestJson<PaperDetailResponse>(`/papers/${encodeURIComponent(paper_id)}`);
  },

  getPaperPageRender(
    paper_id: string,
    page: number,
    options?: { quote?: string | null; zoom?: number },
  ): Promise<PdfPageRenderResponse> {
    const qs = new URLSearchParams();
    qs.set("page", String(Math.max(1, Math.floor(page))));
    if (options?.quote && options.quote.trim()) {
      qs.set("quote", options.quote.trim());
    }
    if (options?.zoom !== undefined) {
      qs.set("zoom", String(options.zoom));
    }
    return requestJson<PdfPageRenderResponse>(
      `/papers/${encodeURIComponent(paper_id)}/page-render?${qs.toString()}`,
    );
  },

  deletePaper(paper_id: string): Promise<DeletePaperResponse> {
    return requestJson<DeletePaperResponse>(`/papers/${encodeURIComponent(paper_id)}`, {
      method: "DELETE",
    });
  },

  reprocessPaper(paper_id: string): Promise<IngestionJob> {
    return requestJson<IngestionJob>(`/papers/${encodeURIComponent(paper_id)}/reprocess`, {
      method: "POST",
    });
  },

  getScaleMatrix(filters: ScaleMatrixFilter): Promise<ScaleMatrixResponse> {
    const qs = buildMatrixQueryParams(filters).toString();
    return requestJson<ScaleMatrixResponse>(`/matrix/scales${qs ? `?${qs}` : ""}`);
  },

  getMatrixMethods(): Promise<MethodCountItem[]> {
    return requestJson<MethodCountItem[]>("/matrix/methods");
  },

  async downloadMatrixExport(format: "csv" | "json", filters: ScaleMatrixFilter): Promise<void> {
    const baseUrl = await resolveApiBaseUrl();
    const locale = useWorkspaceStore.getState().locale;
    const params = buildMatrixQueryParams({ ...filters, limit: undefined, offset: undefined });
    params.set("format", format);
    params.set("locale", locale);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/matrix/export?${params.toString()}`, {
        headers: { "Accept-Language": locale },
      });
    } catch (err) {
      throw new ApiClientError(0, {
        error_code: "BACKEND_UNREACHABLE",
        message: translate(locale, "err.exportUnreachable"),
        details: { cause: err instanceof Error ? err.message : String(err) },
        request_id: null,
      });
    }

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `scale_matrix.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },

  getGraph(params?: GraphFilterParams): Promise<GraphResponse> {
    const locale = useWorkspaceStore.getState().locale;
    const qs = new URLSearchParams();
    qs.set("locale", locale);
    if (params?.min_paper_count !== undefined && params.min_paper_count > 1) {
      qs.set("min_paper_count", String(params.min_paper_count));
    }
    if (params?.direction) {
      qs.set("direction", params.direction);
    }
    if (params?.year_from !== undefined && params.year_from !== null) {
      qs.set("year_from", String(params.year_from));
    }
    if (params?.year_to !== undefined && params.year_to !== null) {
      qs.set("year_to", String(params.year_to));
    }
    if (params?.variable_ids && params.variable_ids.length > 0) {
      for (const vid of params.variable_ids) {
        qs.append("variable_ids", vid);
      }
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestJson<GraphResponse>(`/graph${suffix}`);
  },

  getGraphGaps(params?: { limit?: number; min_gap_score?: number }): Promise<ResearchGap[]> {
    const locale = useWorkspaceStore.getState().locale;
    const qs = new URLSearchParams();
    qs.set("locale", locale);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.min_gap_score !== undefined) qs.set("min_gap_score", String(params.min_gap_score));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return requestJson<ResearchGap[]>(`/graph/gaps${suffix}`);
  },

  getGraphContradictions(edge_key?: string): Promise<ContradictionCluster[]> {
    const suffix = edge_key ? `?edge_key=${encodeURIComponent(edge_key)}` : "";
    return requestJson<ContradictionCluster[]>(`/graph/contradictions${suffix}`);
  },

  mergeVariables(payload: VariableMergeRequest): Promise<Variable> {
    return requestJson<Variable>("/variables/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  getDrafts(): Promise<Draft[]> {
    return requestJson<Draft[]>("/drafts");
  },

  createDraft(payload: DraftCreateRequest): Promise<Draft> {
    return requestJson<Draft>("/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  getDraft(draft_id: string): Promise<Draft> {
    return requestJson<Draft>(`/drafts/${encodeURIComponent(draft_id)}`);
  },

  updateDraft(draft_id: string, payload: DraftUpdateRequest): Promise<Draft> {
    return requestJson<Draft>(`/drafts/${encodeURIComponent(draft_id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteDraft(draft_id: string): Promise<DeleteDraftResponse> {
    return requestJson<DeleteDraftResponse>(`/drafts/${encodeURIComponent(draft_id)}`, {
      method: "DELETE",
    });
  },

  getDraftAudits(draft_id: string): Promise<AuditResult[]> {
    return requestJson<AuditResult[]>(`/drafts/${encodeURIComponent(draft_id)}/audits`);
  },

  auditDraftParagraph(draft_id: string, payload: AuditParagraphRequest): Promise<AuditResult> {
    const locale = payload.locale ?? useWorkspaceStore.getState().locale;
    return requestJson<AuditResult>(`/drafts/${encodeURIComponent(draft_id)}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, locale }),
    });
  },

  dismissAuditFinding(finding_id: string, is_dismissed: boolean): Promise<AuditFinding> {
    return requestJson<AuditFinding>(`/audit-findings/${encodeURIComponent(finding_id)}/dismiss`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_dismissed }),
    });
  },

  getStyleProfiles(): Promise<StyleProfile[]> {
    return requestJson<StyleProfile[]>("/style-profiles");
  },

  extractStyleProfile(payload: StyleExtractRequest): Promise<StyleProfile> {
    const locale = payload.locale ?? useWorkspaceStore.getState().locale;
    return requestJson<StyleProfile>("/style-profiles/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, locale }),
    });
  },

  activateStyleProfile(profile_id: string): Promise<StyleProfile> {
    return requestJson<StyleProfile>(`/style-profiles/${encodeURIComponent(profile_id)}/activate`, {
      method: "PATCH",
    });
  },
};
