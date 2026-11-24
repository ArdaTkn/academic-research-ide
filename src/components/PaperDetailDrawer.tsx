import { useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, X } from "lucide-react";
import { apiClient, ApiClientError } from "@/api/client";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export function PaperDetailDrawer() {
  const selectedPaperId = useWorkspaceStore((s) => s.selectedPaperId);
  const selectedScaleId = useWorkspaceStore((s) => s.selectedScaleId);
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);

  const detailQuery = useQuery({
    queryKey: ["paper-detail", selectedPaperId],
    queryFn: () => apiClient.getPaperDetail(selectedPaperId!),
    enabled: Boolean(selectedPaperId),
  });

  if (!selectedPaperId) return null;

  const data = detailQuery.data;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Makale & Ölçek Detayı</h2>
        </div>
        <button
          type="button"
          onClick={() => focusPaperDetail(null)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Detay çekmecesini kapat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {detailQuery.isLoading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Makale ayrıntıları yükleniyor...
          </div>
        ) : detailQuery.isError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            {detailQuery.error instanceof ApiClientError
              ? `${detailQuery.error.error_code}: ${detailQuery.error.message}`
              : "Makale detayı alınamadı."}
          </div>
        ) : data ? (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold leading-snug text-slate-900">{data.paper.title}</h3>
              <p className="mt-1 text-xs text-slate-600">
                {data.paper.authors.length > 0 ? data.paper.authors.join(", ") : "Yazar belirtilmemiş"}
                {data.paper.year ? ` (${data.paper.year})` : ""}
                {data.paper.journal ? ` · ${data.paper.journal}` : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700 tabular-nums">
                  Örneklem N: {data.paper.sample_size ?? "—"}
                </span>
                <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">
                  Tasarım: {data.paper.research_design ?? "—"}
                </span>
                <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">
                  Yöntemler: {data.paper.statistical_methods.join(", ") || "—"}
                </span>
              </div>
              {data.paper.sample_population && (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-700">Örneklem Profili:</span> {data.paper.sample_population}
                </p>
              )}
            </div>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ölçekler ({data.scales.length})
              </h4>
              {data.scales.length === 0 ? (
                <p className="text-xs text-slate-500">Ölçek kaydı bulunamadı.</p>
              ) : (
                <div className="space-y-2">
                  {data.scales.map((scale) => {
                    const highlighted = selectedScaleId === scale.id;
                    return (
                      <div
                        key={scale.id}
                        className={`rounded-lg border p-3 text-xs ${
                          highlighted ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 bg-slate-50/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-semibold text-slate-900">{scale.name}</div>
                          <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums border border-slate-200">
                            s. {scale.page_number}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          Kaynak: {scale.original_authors ?? "—"}
                          {scale.original_year ? ` (${scale.original_year})` : ""} · Format:{" "}
                          {scale.response_format ?? "—"}
                        </div>
                        <div className="mt-2 grid grid-cols-4 gap-2 text-[11px] tabular-nums">
                          <div className="rounded bg-white px-2 py-1 border border-slate-200">
                            <span className="text-slate-500">Madde:</span>{" "}
                            <span className="font-semibold">{scale.item_count ?? "—"}</span>
                          </div>
                          <div className="rounded bg-white px-2 py-1 border border-slate-200">
                            <span className="text-slate-500">α:</span>{" "}
                            <span className="font-semibold">
                              {scale.cronbach_alpha !== null ? scale.cronbach_alpha.toFixed(2) : "—"}
                            </span>
                          </div>
                          <div className="rounded bg-white px-2 py-1 border border-slate-200">
                            <span className="text-slate-500">CR:</span>{" "}
                            <span className="font-semibold">
                              {scale.composite_reliability !== null ? scale.composite_reliability.toFixed(2) : "—"}
                            </span>
                          </div>
                          <div className="rounded bg-white px-2 py-1 border border-slate-200">
                            <span className="text-slate-500">AVE:</span>{" "}
                            <span className="font-semibold">
                              {scale.ave !== null ? scale.ave.toFixed(2) : "—"}
                            </span>
                          </div>
                        </div>
                        {scale.adaptation_notes && (
                          <p className="mt-2 text-[11px] text-slate-600">{scale.adaptation_notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Değişkenler & Roller ({data.variables.length})
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {data.variables.map((pv) => (
                  <span
                    key={pv.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-800"
                  >
                    <span className="font-medium">{pv.local_name}</span>
                    <span className="rounded bg-slate-200 px-1 py-0.2 text-[10px] text-slate-700">{pv.role}</span>
                  </span>
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sayfa Referanslı Ana İddialar ({data.claims.length})
              </h4>
              <div className="space-y-2">
                {data.claims.map((claim) => (
                  <div key={claim.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-medium uppercase">{claim.claim_type}</span>
                      <span className="tabular-nums">s. {claim.page_number}</span>
                    </div>
                    <p className="mt-1 text-slate-800">{claim.claim_text}</p>
                    {claim.quote_snippet && (
                      <blockquote className="mt-1.5 border-l-2 border-indigo-200 pl-2 text-[11px] italic text-slate-600">
                        “{claim.quote_snippet}”
                      </blockquote>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
