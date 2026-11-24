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
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { ScaleMatrixRow } from "@/types/contracts";

const columnHelper = createColumnHelper<ScaleMatrixRow>();

function alphaBadgeClass(alpha: number | null): string {
  if (alpha === null) return "border-slate-200 bg-slate-50 text-slate-500";
  if (alpha >= 0.8) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (alpha >= 0.7) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function formatNum(value: number | null, digits = 2): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

export function ScaleMatrixTab() {
  const matrixFilters = useWorkspaceStore((s) => s.matrixFilters);
  const setMatrixFilters = useWorkspaceStore((s) => s.setMatrixFilters);
  const resetMatrixFilters = useWorkspaceStore((s) => s.resetMatrixFilters);
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);

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
    queryKey: ["graph"],
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
          <span>Ölçek Adı & Kaynak</span>
          {renderSortIcon("scale_name")}
        </button>
      ),
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="min-w-[200px]">
            <div className="font-medium text-slate-900">{row.scale_name}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {row.original_authors ?? "Orijinal kaynak belirtilmemiş"}
              {row.original_year ? ` (${row.original_year})` : ""}
              {row.response_format ? ` · ${row.response_format}` : ""}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor("variable_label", {
      header: "Değişken",
      cell: (info) => {
        const val = info.getValue();
        return val ? (
          <span className="inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {val}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
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
          <span>Cronbach α</span>
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
              {formatNum(alpha, 2)}
            </span>
            {(row.composite_reliability !== null || row.ave !== null) && (
              <div className="mt-0.5 text-[10px] text-slate-500">
                CR {formatNum(row.composite_reliability, 2)} · AVE {formatNum(row.ave, 2)}
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
          <span>Madde</span>
          {renderSortIcon("item_count")}
        </button>
      ),
      cell: (info) => {
        const val = info.getValue();
        return <span className="tabular-nums text-xs text-slate-700">{val ?? "—"}</span>;
      },
    }),
    columnHelper.accessor("sample_size", {
      header: () => (
        <button
          type="button"
          onClick={() => toggleSort("sample_size")}
          className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900"
        >
          <span>Örneklem (N)</span>
          {renderSortIcon("sample_size")}
        </button>
      ),
      cell: (info) => {
        const n = info.getValue();
        const pop = info.row.original.sample_population;
        return (
          <div className="min-w-[140px]">
            <div className="tabular-nums text-xs font-medium text-slate-800">{n ?? "—"}</div>
            <div className="truncate text-[11px] text-slate-500" title={pop ?? undefined}>
              {pop ?? "—"}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor("statistical_methods", {
      header: "İstatistiksel Yöntem",
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
                <span className="text-xs text-slate-400">—</span>
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
          <span>Makale & Yıl</span>
          {renderSortIcon("year")}
        </button>
      ),
      cell: (info) => {
        const row = info.row.original;
        return (
          <div className="max-w-[240px]">
            <div className="line-clamp-2 text-xs font-medium text-slate-900">{row.paper_title}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {row.authors[0] ?? "—"} · {row.year ?? "—"} ·{" "}
              <span className="font-medium text-slate-700 tabular-nums">s. {row.page_number}</span>
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
        err instanceof ApiClientError ? `${err.error_code}: ${err.message}` : "Dışa aktarım başarısız oldu."
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
    matrixFilters.year_from !== null && matrixFilters.year_from !== undefined,
    matrixFilters.year_to !== null && matrixFilters.year_to !== undefined,
  ].filter(Boolean).length;

  const queryErrorText =
    matrixQuery.error instanceof ApiClientError
      ? `${matrixQuery.error.error_code}: ${matrixQuery.error.message}`
      : matrixQuery.isError
        ? "Ölçek ve yöntem matrisi verileri alınamadı."
        : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Üst Filtre & Dışa Aktarım Çubuğu */}
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">Ölçek & Yöntem Matrisi</h1>
            <p className="text-xs text-slate-500">
              Makalelerdeki ölçme araçlarını, Cronbach α güvenilirliğini, örneklem profillerini ve analiz yöntemlerini kıyaslayın.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport("csv")}
              disabled={isExporting !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isExporting === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>CSV İndir</span>
            </button>
            <button
              type="button"
              onClick={() => void handleExport("json")}
              disabled={isExporting !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isExporting === "json" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>JSON İndir</span>
            </button>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-2.5 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              aria-label="Ölçek veya makale ara"
              value={matrixFilters.search ?? ""}
              onChange={(e) => setMatrixFilters({ search: e.target.value })}
              placeholder="Ölçek adı, makale veya yazar ara..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <select
            aria-label="Değişken filtresi"
            value={matrixFilters.variable_id ?? ""}
            onChange={(e) => setMatrixFilters({ variable_id: e.target.value || null })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Tüm Değişkenler</option>
            {(graphQuery.data?.nodes ?? []).map((node) => (
              <option key={node.variable_id} value={node.variable_id}>
                {node.display_label} ({node.paper_count})
              </option>
            ))}
          </select>

          <select
            aria-label="İstatistiksel yöntem filtresi"
            value={matrixFilters.statistical_method ?? ""}
            onChange={(e) => setMatrixFilters({ statistical_method: e.target.value || null })}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Tüm Yöntemler</option>
            {(methodsQuery.data ?? []).map((m) => (
              <option key={m.method} value={m.method}>
                {m.method} ({m.count})
              </option>
            ))}
          </select>

          <input
            type="number"
            aria-label="Minimum Cronbach alpha"
            step="0.05"
            min={0}
            max={1}
            value={matrixFilters.min_alpha ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setMatrixFilters({ min_alpha: v === "" ? null : Number.parseFloat(v) });
            }}
            placeholder="Min. α (ör. 0.70)"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none"
          />

          <input
            type="number"
            aria-label="Minimum örneklem büyüklüğü"
            min={0}
            value={matrixFilters.min_sample_size ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setMatrixFilters({ min_sample_size: v === "" ? null : Number.parseInt(v, 10) });
            }}
            placeholder="Min. N (ör. 200)"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Hızlı α Eşiği:</span>
            {[
              { label: "Tümü", value: null },
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
              <span>Yıl:</span>
              <input
                type="number"
                aria-label="Başlangıç yılı"
                min={1800}
                max={2100}
                value={matrixFilters.year_from ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setMatrixFilters({ year_from: v === "" ? null : Number.parseInt(v, 10) });
                }}
                placeholder="Min"
                className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-800"
              />
              <span>–</span>
              <input
                type="number"
                aria-label="Bitiş yılı"
                min={1800}
                max={2100}
                value={matrixFilters.year_to ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setMatrixFilters({ year_to: v === "" ? null : Number.parseInt(v, 10) });
                }}
                placeholder="Max"
                className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-800"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="tabular-nums">
              Toplam <strong className="text-slate-900">{total}</strong> ölçek kaydı
            </span>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetMatrixFilters}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <FilterX className="h-3.5 w-3.5" />
                <span>Filtreleri Sıfırla ({activeFilterCount})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hata Mesajı */}
      {(queryErrorText || exportError) && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{queryErrorText ?? exportError}</span>
        </div>
      )}

      {/* Tablo Alanı */}
      <div className="flex-1 overflow-auto p-5">
        {matrixQuery.isLoading ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
            Ölçek ve yöntem matrisi yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
            <FileSpreadsheet className="mb-2.5 h-8 w-8 text-slate-400" />
            <div className="text-sm font-medium text-slate-800">Görüntülenecek ölçek kaydı bulunamadı</div>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              {activeFilterCount > 0
                ? "Seçili filtrelere uyan ölçek bulunamadı. Filtreleri gevşeterek tekrar deneyin."
                : "Sol panelden PDF makaleler yüklediğinizde çıkarılan ölçekler, Cronbach α değerleri ve yöntemler burada listelenir."}
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

            {/* Sayfalama */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600">
              <span className="tabular-nums">
                Gösterilen: {offset + 1}–{Math.min(offset + rows.length, total)} / {total}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={offset <= 0}
                  onClick={() => setMatrixFilters({ offset: Math.max(0, offset - limit) })}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={offset + limit >= total}
                  onClick={() => setMatrixFilters({ offset: offset + limit })}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Sonraki
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
