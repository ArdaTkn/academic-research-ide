import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FilterX,
  Loader2,
  Search,
} from "lucide-react";
import { useState } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { GroundingBadge } from "@/components/GroundingBadge";
import { useI18n } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { GroundingStatus, ScaleMatrixRow } from "@/types/contracts";

const columnHelper = createColumnHelper<ScaleMatrixRow>();

function alphaBadgeClass(alpha: number | null): string {
  if (alpha === null) return "border-slate-200 bg-slate-50 text-slate-500";
  if (alpha >= 0.8) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (alpha >= 0.7) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

export function ScaleMatrixTab() {
  const { t, locale, formatNumber } = useI18n();
  const matrixFilters = useWorkspaceStore((s) => s.matrixFilters);
  const setMatrixFilters = useWorkspaceStore((s) => s.setMatrixFilters);
  const resetMatrixFilters = useWorkspaceStore((s) => s.resetMatrixFilters);
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);
  const openPdfAtPage = useWorkspaceStore((s) => s.openPdfAtPage);

  const formatDecimal = (value: number | null, digits = 2): string =>
    value === null || value === undefined
      ? t("common.dash")
      : formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<"csv" | "json" | null>(null);

  const matrixQuery = useQuery({
    queryKey: ["matrix", matrixFilters],
    queryFn: () => apiClient.getScaleMatrix(matrixFilters),
  });

  const methodsQuery = useQuery({
    queryKey: ["matrix-methods"],
    queryFn: () => apiClient.getMatrixMethods(),
  });

  const graphQuery = useQuery({
    queryKey: ["graph", locale],
    queryFn: () => apiClient.getGraph(),
  });

  const toggleSort = (field: string) => {
    const isSame = matrixFilters.sort_by === field;
    const nextDir = isSame && matrixFilters.sort_dir === "desc" ? "asc" : "desc";
    setMatrixFilters({ sort_by: field, sort_dir: nextDir });
  };

  const renderSortIcon = (field: string) => {
    if (matrixFilters.sort_by !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    }
    return matrixFilters.sort_dir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-indigo-600" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-indigo-600" />
    );
  };

  const columns = [
    columnHelper.accessor("scale_name", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("scale_name")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{t("matrix.col.scale")}</span>
          {renderSortIcon("scale_name")}
        </button>
      ),
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="min-w-[200px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-slate-900">{row.scale_name}</span>
              <GroundingBadge
                compact
                status={row.grounding_status}
                score={row.grounding_score}
                note={row.grounding_note}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {row.original_authors ?? t("matrix.originalSourceMissing")}
              {row.original_year ? ` (${row.original_year})` : ""}
              {row.response_format ? ` · ${row.response_format}` : ""}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor("variable_label", {
      header: t("matrix.col.variable"),
      cell: (info) => {
        const val = info.getValue();
        return val ? (
          <span className="inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {val}
          </span>
        ) : (
          <span className="text-xs text-slate-400">{t("common.dash")}</span>
        );
      },
    }),
    columnHelper.accessor("cronbach_alpha", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("cronbach_alpha")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{t("matrix.col.alpha")}</span>
          {renderSortIcon("cronbach_alpha")}
        </button>
      ),
      cell: (info) => {
        const alpha = info.getValue();
        const row = info.row.original;
        return (
          <div className="tabular-nums">
            <span
              className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${alphaBadgeClass(alpha)}`}
            >
              {formatDecimal(alpha, 2)}
            </span>
            {(row.composite_reliability !== null || row.ave !== null) && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                CR {formatDecimal(row.composite_reliability, 2)} · AVE {formatDecimal(row.ave, 2)}
              </div>
            )}
          </div>
        );
      },
    }),
    columnHelper.accessor("item_count", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("item_count")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{t("matrix.col.items")}</span>
          {renderSortIcon("item_count")}
        </button>
      ),
      cell: (info) => {
        const val = info.getValue();
        return (
          <span className="tabular-nums text-xs text-slate-700">
            {val !== null ? formatNumber(val) : t("common.dash")}
          </span>
        );
      },
    }),
    columnHelper.accessor("sample_size", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("sample_size")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{t("matrix.col.sample")}</span>
          {renderSortIcon("sample_size")}
        </button>
      ),
      cell: (info) => {
        const n = info.getValue();
        const pop = info.row.original.sample_population;
        return (
          <div className="min-w-[140px]">
            <div className="tabular-nums text-xs font-medium text-slate-800">
              {n !== null ? formatNumber(n) : t("common.dash")}
            </div>
            <div className="truncate text-[11px] text-slate-500" title={pop ?? undefined}>
              {pop ?? t("common.dash")}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor("statistical_methods", {
      header: t("matrix.col.methods"),
      cell: (info) => {
        const methods = info.getValue();
        const design = info.row.original.research_design;
        return (
          <div className="min-w-[150px]">
            <div className="flex flex-wrap gap-1">
              {methods.length > 0 ? (
                methods.map((m) => (
                  <span
                    key={m}
                    className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                  >
                    {m}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">{t("common.dash")}</span>
              )}
            </div>
            {design && <div className="mt-0.5 text-[10px] text-slate-500">{design}</div>}
          </div>
        );
      },
    }),
    columnHelper.accessor("paper_title", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("year")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>{t("matrix.col.paper")}</span>
          {renderSortIcon("year")}
        </button>
      ),
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="max-w-[240px]">
            <div className="line-clamp-2 text-xs font-medium text-slate-900">{row.paper_title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
              <span>
                {row.authors[0] ?? t("common.dash")} · {row.year ?? t("common.dash")} ·
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openPdfAtPage(
                    row.paper_id,
                    row.page_number,
                    row.quote_snippet ?? row.scale_name,
                    row.paper_title,
                  );
                }}
                title={t("pdfReader.openAtPage", { page: row.page_number })}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.2 font-medium text-indigo-700 tabular-nums hover:border-indigo-300 hover:bg-indigo-50"
              >
                {t("common.pageShort", { page: row.page_number })}
              </button>
            </div>
          </div>
        );
      },
    }),
  ];

  const rows = matrixQuery.data?.items ?? [];
  const total = matrixQuery.data?.total ?? 0;
  const limit = matrixFilters.limit ?? 25;
  const offset = matrixFilters.offset ?? 0;

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const handleExport = async (format: "csv" | "json") => {
    setExportError(null);
    setIsExporting(format);
    try {
      await apiClient.downloadMatrixExport(format, matrixFilters);
    } catch (err) {
      setExportError(
        err instanceof ApiClientError ? `${err.error_code}: ${err.message}` : t("matrix.exportFailed")
      );
    } finally {
      setIsExporting(null);
    }
  };

  const activeFilterCount = [
    Boolean(matrixFilters.search && matrixFilters.search.trim()),
    Boolean(matrixFilters.variable_id),
    matrixFilters.min_alpha !== null && matrixFilters.min_alpha !== undefined,
    matrixFilters.min_sample_size !== null && matrixFilters.min_sample_size !== undefined,
    Boolean(matrixFilters.statistical_method),
    Boolean(matrixFilters.grounding_status),
    matrixFilters.year_from !== null && matrixFilters.year_from !== undefined,
    matrixFilters.year_to !== null && matrixFilters.year_to !== undefined,
  ].filter(Boolean).length;

  const queryErrorText =
    matrixQuery.error instanceof ApiClientError
      ? `${matrixQuery.error.error_code}: ${matrixQuery.error.message}`
      : matrixQuery.isError
        ? t("matrix.loadFailed")
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">{t("matrix.title")}</h1>
            <p className="text-xs text-slate-500">{t("matrix.subtitle")}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport("csv")}
              disabled={isExporting !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isExporting === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{t("matrix.exportCsv")}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExport("json")}
              disabled={isExporting !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isExporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{t("matrix.exportJson")}</span>
            </button>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-2.5 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              aria-label={t("matrix.searchAria")}
              value={matrixFilters.search ?? ""}
              onChange={(e) => setMatrixFilters({ search: e.target.value })}
              placeholder={t("matrix.searchPlaceholder")}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <select
            aria-label={t("matrix.variableAria")}
            value={matrixFilters.variable_id ?? ""}
            onChange={(e) => setMatrixFilters({ variable_id: e.target.value || null })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">{t("matrix.allVariables")}</option>
            {(graphQuery.data?.nodes ?? []).map((node) => (
              <option key={node.variable_id} value={node.variable_id}>
                {node.display_label} ({node.paper_count})
              </option>
            ))}
          </select>

          <select
            aria-label={t("matrix.methodAria")}
            value={matrixFilters.statistical_method ?? ""}
            onChange={(e) => setMatrixFilters({ statistical_method: e.target.value || null })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">{t("matrix.allMethods")}</option>
            {(methodsQuery.data ?? []).map((m) => (
              <option key={m.method} value={m.method}>
                {m.method} ({m.count})
              </option>
            ))}
          </select>

          <input
            type="number"
            aria-label={t("matrix.minAlphaAria")}
            step="0.05"
            min={0}
            max={1}
            value={matrixFilters.min_alpha ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setMatrixFilters({ min_alpha: v === "" ? null : Number.parseFloat(v) });
            }}
            placeholder={t("matrix.minAlphaPlaceholder")}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none"
          />

          <input
            type="number"
            aria-label={t("matrix.minSampleAria")}
            min={0}
            value={matrixFilters.min_sample_size ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setMatrixFilters({ min_sample_size: v === "" ? null : Number.parseInt(v, 10) });
            }}
            placeholder={t("matrix.minSamplePlaceholder")}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">{t("matrix.quickAlphaLabel")}</span>
            {[
              { label: t("matrix.quickAlphaAll"), value: null },
              { label: "α ≥ 0.70", value: 0.7 },
              { label: "α ≥ 0.80", value: 0.8 },
            ].map((chip) => {
              const active = (matrixFilters.min_alpha ?? null) === chip.value;
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setMatrixFilters({ min_alpha: chip.value })}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                    active
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}

            <div className="ml-2 flex items-center gap-1 text-[11px] text-slate-500">
              <span>{t("matrix.yearLabel")}</span>
              <input
                type="number"
                aria-label={t("matrix.yearFromAria")}
                min={1800}
                max={2100}
                value={matrixFilters.year_from ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setMatrixFilters({ year_from: v === "" ? null : Number.parseInt(v, 10) });
                }}
                placeholder={t("matrix.yearMinPlaceholder")}
                className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-800"
              />
              <span>–</span>
              <input
                type="number"
                aria-label={t("matrix.yearToAria")}
                min={1800}
                max={2100}
                value={matrixFilters.year_to ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setMatrixFilters({ year_to: v === "" ? null : Number.parseInt(v, 10) });
                }}
                placeholder={t("matrix.yearMaxPlaceholder")}
                className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-800"
              />
            </div>

            <div className="ml-2 flex items-center gap-1 text-[11px] text-slate-500">
              <span>{t("grounding.filterLabel")}</span>
              <select
                aria-label={t("grounding.filterLabel")}
                value={matrixFilters.grounding_status ?? ""}
                onChange={(e) => {
                  const val = e.target.value as GroundingStatus | "";
                  setMatrixFilters({ grounding_status: val === "" ? null : val });
                }}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-800 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">{t("grounding.filterAll")}</option>
                <option value="verified">{t("grounding.verified")}</option>
                <option value="partial">{t("grounding.partial")}</option>
                <option value="unverified">{t("grounding.unverified")}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="tabular-nums">
              {t("matrix.totalScalesPrefix")} <strong className="text-slate-900">{formatNumber(total)}</strong>{" "}
              {t("matrix.totalScalesSuffix")}
            </span>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetMatrixFilters}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <FilterX className="h-3.5 w-3.5" />
                <span>{t("matrix.resetFilters", { count: activeFilterCount })}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {(queryErrorText || exportError) && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{queryErrorText ?? exportError}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-5">
        {matrixQuery.isLoading ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
            {t("matrix.loading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
            <FileSpreadsheet className="mb-2.5 h-8 w-8 text-slate-400" />
            <div className="text-sm font-medium text-slate-800">{t("matrix.emptyTitle")}</div>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              {activeFilterCount > 0 ? t("matrix.emptyFiltered") : t("matrix.emptyInitial")}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/90 text-slate-700">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="whitespace-nowrap px-4 py-3 font-semibold">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => focusPaperDetail(row.original.paper_id, row.original.scale_id)}
                      className="cursor-pointer transition hover:bg-indigo-50/40"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
              <span className="tabular-nums">
                {t("matrix.showingRange", {
                  start: offset + 1,
                  end: Math.min(offset + rows.length, total),
                  total: formatNumber(total),
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={offset <= 0}
                  onClick={() => setMatrixFilters({ offset: Math.max(0, offset - limit) })}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {t("matrix.prev")}
                </button>
                <button
                  type="button"
                  disabled={offset + limit >= total}
                  onClick={() => setMatrixFilters({ offset: offset + limit })}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  {t("matrix.next")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
