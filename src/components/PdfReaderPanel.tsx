import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileWarning,
  Loader2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ApiClientError, apiClient } from "@/api/client";
import { useI18n } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export function PdfReaderPanel() {
  const { t } = useI18n();
  const pdfViewer = useWorkspaceStore((s) => s.pdfViewer);
  const setPdfViewerPage = useWorkspaceStore((s) => s.setPdfViewerPage);
  const closePdfViewer = useWorkspaceStore((s) => s.closePdfViewer);

  const [zoom, setZoom] = useState(2.0);
  const [showExtractedText, setShowExtractedText] = useState(false);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: [
      "paper-page-render",
      pdfViewer?.paperId ?? null,
      pdfViewer?.pageNumber ?? 1,
      pdfViewer?.quote ?? null,
      zoom,
    ],
    queryFn: () =>
      apiClient.getPaperPageRender(pdfViewer!.paperId, pdfViewer!.pageNumber, {
        quote: pdfViewer!.quote ?? undefined,
        zoom,
      }),
    enabled: Boolean(pdfViewer),
    retry: false,
  });

  if (!pdfViewer) {
    return null;
  }

  const title = pdfViewer.paperTitle ?? data?.paper_title ?? t("pdfReader.title");
  const totalPages = data?.page_count ?? null;
  const errorCode = error instanceof ApiClientError ? error.error_code : null;
  const errorMessage =
    error instanceof Error ? error.message : String(error ?? "");

  return (
    <aside
      aria-label={t("pdfReader.title")}
      className="flex h-full w-[420px] shrink-0 flex-col border-l border-slate-200 bg-white xl:w-[500px]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span>{t("pdfReader.title")}</span>
          </div>
          <h2 className="mt-0.5 truncate text-xs font-semibold text-slate-900" title={title}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={closePdfViewer}
          aria-label={t("pdfReader.close")}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPdfViewerPage(pdfViewer.pageNumber - 1)}
            disabled={pdfViewer.pageNumber <= 1 || isFetching}
            aria-label={t("pdfReader.prevPage")}
            className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 text-xs font-medium tabular-nums text-slate-700">
            {t("pdfReader.pageIndicator", {
              page: data?.page_number ?? pdfViewer.pageNumber,
              total: totalPages ?? "—",
            })}
          </span>
          <button
            type="button"
            onClick={() => setPdfViewerPage(pdfViewer.pageNumber + 1)}
            disabled={!totalPages || pdfViewer.pageNumber >= totalPages || isFetching}
            aria-label={t("pdfReader.nextPage")}
            className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1.0, Number((z - 0.25).toFixed(2))))}
            disabled={zoom <= 1.0 || isFetching}
            aria-label={t("pdfReader.zoomOut")}
            className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center text-[11px] font-medium tabular-nums text-slate-600">
            {Math.round((zoom / 2.0) * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.25).toFixed(2))))}
            disabled={zoom >= 3.0 || isFetching}
            aria-label={t("pdfReader.zoomIn")}
            className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {pdfViewer.quote && (
        <div className="border-b border-slate-200 bg-slate-50/70 px-3.5 py-2 text-[11px]">
          <p className="line-clamp-2 italic text-slate-600">“{pdfViewer.quote}”</p>
          {data && (
            <div className="mt-1.5">
              {data.highlights.length > 0 ? (
                <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                  {t("pdfReader.quoteHighlightMatched", { count: data.highlights.length })}
                </span>
              ) : data.match_found ? (
                <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                  {t("pdfReader.quoteTextOnlyMatch")}
                </span>
              ) : (
                <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  {t("pdfReader.quoteNotHighlighted")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-slate-100 p-3">
        {isLoading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            <span>{t("pdfReader.loading", { page: pdfViewer.pageNumber })}</span>
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <div className="flex items-start gap-2">
              {errorCode === "PDF_FILE_MISSING" ? (
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-rose-900">
                  {errorCode === "PDF_FILE_MISSING"
                    ? t("pdfReader.errorMissingTitle")
                    : errorCode === "PDF_PAGE_OUT_OF_RANGE"
                      ? t("pdfReader.errorOutOfRangeTitle")
                      : t("common.unexpectedError")}
                </div>
                <p className="mt-1 text-rose-700">{errorMessage}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {errorCode === "PDF_PAGE_OUT_OF_RANGE" && (
                    <button
                      type="button"
                      onClick={() => setPdfViewerPage(1)}
                      className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                    >
                      {t("pdfReader.jumpToFirstPage")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{t("pdfReader.retry")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : data ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
              <img
                src={data.image_data_url}
                alt={`${title} - ${data.page_number}`}
                className="block h-auto w-full select-none"
              />
              {data.highlights.map((box, index) => (
                <div
                  key={`${index}-${box.x}-${box.y}`}
                  data-testid="pdf-highlight-box"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                  className="pointer-events-none absolute rounded-[2px] bg-amber-400/35 ring-1 ring-amber-500/80"
                />
              ))}
            </div>

            {data.page_text && (
              <div className="rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowExtractedText((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span>
                    {showExtractedText
                      ? t("pdfReader.hideExtractedText")
                      : t("pdfReader.showExtractedText")}
                  </span>
                  {showExtractedText ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {showExtractedText && (
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-slate-200 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-700">
                    {data.page_text}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
