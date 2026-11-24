import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  FolderPlus,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { subscribeToJob } from "@/api/sse";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { IngestionJob, IngestionStatus } from "@/types/contracts";

const STATUS_BADGE: Record<IngestionStatus, { label: string; cls: string }> = {
  completed: { label: "Hazır", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  processing: { label: "İşleniyor", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  pending: { label: "Bekliyor", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  partial: { label: "Kısmi", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  failed: { label: "Hata", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

const JOB_LABELS: Record<IngestionJob["status"], string> = {
  queued: "Kuyrukta",
  extracting_text: "PDF Metni Çıkarılıyor",
  parsing_llm: "LLM Yapılandırılıyor",
  indexing_vectors: "Vektör İndeksleniyor",
  completed: "Tamamlandı",
  failed: "Başarısız",
};

function parseJobError(errorDetail: string | null): string {
  if (!errorDetail) return "İşlem başarısız oldu.";
  try {
    const parsed = JSON.parse(errorDetail) as { error_code?: string; message?: string };
    if (parsed.error_code && parsed.message) {
      return `${parsed.error_code}: ${parsed.message}`;
    }
    return parsed.message ?? errorDetail;
  } catch {
    return errorDetail;
  }
}

export function IngestionSidebar() {
  const queryClient = useQueryClient();
  const isCollapsed = useWorkspaceStore((s) => s.isSidebarCollapsed);
  const selectedPaperId = useWorkspaceStore((s) => s.selectedPaperId);
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);
  const activeJobs = useWorkspaceStore((s) => s.activeJobs);
  const upsertJob = useWorkspaceStore((s) => s.upsertJob);
  const dismissJob = useWorkspaceStore((s) => s.dismissJob);

  const [paperSearch, setPaperSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showPathInput, setShowPathInput] = useState(false);
  const [localPathText, setLocalPathText] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subscriptionsRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    return () => {
      Object.values(subscriptionsRef.current).forEach((unsub) => unsub());
      subscriptionsRef.current = {};
    };
  }, []);

  const papersQuery = useQuery({
    queryKey: ["papers", paperSearch],
    queryFn: () => apiClient.getPapers({ search: paperSearch || undefined, limit: 100 }),
  });

  const trackJobs = (jobs: IngestionJob[]) => {
    for (const job of jobs) {
      upsertJob(job);
      if (subscriptionsRef.current[job.id]) {
        subscriptionsRef.current[job.id]();
      }
      subscriptionsRef.current[job.id] = subscribeToJob(job.id, {
        onUpdate: (updated) => {
          upsertJob(updated);
        },
        onComplete: (done) => {
          upsertJob(done);
          delete subscriptionsRef.current[job.id];
          void queryClient.invalidateQueries({ queryKey: ["papers"] });
          void queryClient.invalidateQueries({ queryKey: ["matrix"] });
          void queryClient.invalidateQueries({ queryKey: ["matrix-methods"] });
          void queryClient.invalidateQueries({ queryKey: ["graph"] });
        },
        onError: (err) => {
          setUploadError(err.message);
          delete subscriptionsRef.current[job.id];
        },
      });
    }
  };

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => apiClient.ingestFiles(files),
    onSuccess: (jobs) => {
      setUploadError(null);
      trackJobs(jobs);
    },
    onError: (err) => {
      setUploadError(
        err instanceof ApiClientError ? `${err.error_code}: ${err.message}` : "PDF yükleme başlatılamadı."
      );
    },
  });

  const pathMutation = useMutation({
    mutationFn: (paths: string[]) => apiClient.ingestPaths(paths),
    onSuccess: (jobs) => {
      setUploadError(null);
      setLocalPathText("");
      setShowPathInput(false);
      trackJobs(jobs);
    },
    onError: (err) => {
      setUploadError(
        err instanceof ApiClientError ? `${err.error_code}: ${err.message}` : "Yol üzerinden ekleme başarısız."
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (paperId: string) => apiClient.deletePaper(paperId),
    onSuccess: (_res, paperId) => {
      if (selectedPaperId === paperId) {
        focusPaperDetail(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["papers"] });
      void queryClient.invalidateQueries({ queryKey: ["matrix"] });
      void queryClient.invalidateQueries({ queryKey: ["matrix-methods"] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (paperId: string) => apiClient.reprocessPaper(paperId),
    onSuccess: (job) => trackJobs([job]),
  });

  if (isCollapsed) {
    return null;
  }

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const pdfs = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length === 0) {
      setUploadError("Yalnızca .pdf uzantılı dosyalar yüklenebilir.");
      return;
    }
    uploadMutation.mutate(pdfs);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilesSelected(e.dataTransfer.files);
  };

  const handleSubmitPaths = () => {
    const paths = localPathText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length === 0) return;
    pathMutation.mutate(paths);
  };

  const jobsList = Object.values(activeJobs).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const papers = papersQuery.data?.items ?? [];

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Makale Havuzu</h2>
          <button
            type="button"
            onClick={() => setShowPathInput((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
            title="Yerel PDF dosya yolundan içe aktar"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Yoldan Ekle</span>
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center transition ${
            isDragging
              ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
              : "border-slate-200 bg-slate-50/70 text-slate-600 hover:border-indigo-300 hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
          {uploadMutation.isPending ? (
            <Loader2 className="mb-1.5 h-5 w-5 animate-spin text-indigo-600" />
          ) : (
            <FileUp className="mb-1.5 h-5 w-5 text-indigo-600" />
          )}
          <span className="text-xs font-medium text-slate-800">PDF Sürükle-Bırak veya Seç</span>
          <span className="mt-0.5 text-[11px] text-slate-500">Değişken, ölçek ve iddialar otomatik ayrıştırılır</span>
        </div>

        {showPathInput && (
          <div className="mt-2.5 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <textarea
              rows={2}
              value={localPathText}
              onChange={(e) => setLocalPathText(e.target.value)}
              placeholder="Her satıra bir PDF dosya yolu yazın..."
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-800 focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setShowPathInput(false)}
                className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSubmitPaths}
                disabled={pathMutation.isPending}
                className="rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Başlat
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800">
            <span>{uploadError}</span>
            <button type="button" onClick={() => setUploadError(null)} className="shrink-0 text-rose-500">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {jobsList.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-y-auto border-b border-slate-200 bg-slate-50/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Canlı Ayrıştırma Akışı ({jobsList.length})
          </div>
          {jobsList.map((job) => {
            const fileName = job.file_path.split(/[/\\]/).pop() ?? job.file_path;
            const isFailed = job.status === "failed";
            const isDone = job.status === "completed";
            return (
              <div key={job.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800" title={job.file_path}>
                    {fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => dismissJob(job.id)}
                    className="shrink-0 text-slate-400 hover:text-slate-600"
                    title="Bildirimi Gizle"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : isFailed ? (
                      <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                    )}
                    {JOB_LABELS[job.status]}
                  </span>
                  <span className="tabular-nums text-slate-500">{job.progress_percent}%</span>
                </div>

                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full transition-all ${
                      isFailed ? "bg-rose-500" : isDone ? "bg-emerald-500" : "bg-indigo-600"
                    }`}
                    style={{ width: `${job.progress_percent}%` }}
                  />
                </div>

                {isFailed && job.error_detail && (
                  <p className="mt-1.5 text-[11px] leading-snug text-rose-700">{parseJobError(job.error_detail)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="border-b border-slate-200 px-3.5 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={paperSearch}
            onChange={(e) => setPaperSearch(e.target.value)}
            placeholder="Makale veya yazar ara..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {papersQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-xs text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Makaleler yükleniyor...
          </div>
        ) : papersQuery.isError ? (
          <div className="m-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            {papersQuery.error instanceof ApiClientError
              ? `${papersQuery.error.error_code}: ${papersQuery.error.message}`
              : "Makale listesi alınamadı."}
          </div>
        ) : papers.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-500">
            Havuzda henüz makale yok. Yukarıdan PDF yükleyerek başlayın.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {papers.map((paper) => {
              const badge = STATUS_BADGE[paper.ingestion_status];
              const isSelected = selectedPaperId === paper.id;
              return (
                <li
                  key={paper.id}
                  className={`group rounded-lg border p-2.5 transition ${
                    isSelected
                      ? "border-indigo-300 bg-indigo-50/50"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => focusPaperDetail(paper.id)}
                      className="flex-1 text-left"
                    >
                      <div className="line-clamp-2 text-xs font-medium leading-snug text-slate-900">
                        {paper.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span>{paper.year ?? "—"}</span>
                        <span>·</span>
                        <span className="tabular-nums">N={paper.sample_size ?? "—"}</span>
                        <span>·</span>
                        <span className="tabular-nums">{paper.page_count} s.</span>
                      </div>
                    </button>

                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-end gap-1 opacity-75 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => reprocessMutation.mutate(paper.id)}
                      disabled={reprocessMutation.isPending}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70"
                      title="Makaleyi Yeniden Ayrıştır"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Yenile</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(paper.id)}
                      disabled={deleteMutation.isPending}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                      title="Makaleyi Sil"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Sil</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
