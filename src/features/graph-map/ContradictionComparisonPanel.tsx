import { ArrowRight, BookOpen, GitCompareArrows, Scale } from "lucide-react";
import { GroundingBadge } from "@/components/GroundingBadge";
import { useI18n, type TranslationKey } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { ContradictionCluster, ContradictionPaperSide, RelationshipDirection } from "@/types/contracts";

const DIRECTION_STYLE: Record<RelationshipDirection, { key: TranslationKey; badge: string; border: string }> = {
  positive: {
    key: "graph.dir.positive",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    border: "border-l-emerald-500",
  },
  negative: {
    key: "graph.dir.negative",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    border: "border-l-rose-500",
  },
  insignificant: {
    key: "graph.dir.insignificant",
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    border: "border-l-slate-400",
  },
  mixed: {
    key: "graph.dir.mixed",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    border: "border-l-amber-500",
  },
  curvilinear: {
    key: "graph.dir.curvilinear",
    badge: "bg-violet-50 text-violet-800 border-violet-200",
    border: "border-l-violet-500",
  },
};

function groupByDirection(sides: ContradictionPaperSide[]): Array<[RelationshipDirection, ContradictionPaperSide[]]> {
  const map = new Map<RelationshipDirection, ContradictionPaperSide[]>();
  for (const side of sides) {
    const existing = map.get(side.direction) ?? [];
    existing.push(side);
    map.set(side.direction, existing);
  }
  return Array.from(map.entries());
}

export function ContradictionComparisonPanel({ cluster }: { cluster: ContradictionCluster }) {
  const { t, formatNumber } = useI18n();
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);
  const openPdfAtPage = useWorkspaceStore((s) => s.openPdfAtPage);

  const grouped = groupByDirection(cluster.opposing_sides);
  const sampleSizes = cluster.opposing_sides
    .map((s) => s.sample_size)
    .filter((n): n is number => n !== null && n !== undefined);
  const distinctMethods = Array.from(
    new Set(
      cluster.opposing_sides
        .map((s) => s.statistical_method)
        .filter((m): m is string => Boolean(m && m.trim()))
    )
  );

  const sampleRange =
    sampleSizes.length > 0
      ? sampleSizes.length === 1 || Math.min(...sampleSizes) === Math.max(...sampleSizes)
        ? `N = ${formatNumber(sampleSizes[0])}`
        : `N = ${formatNumber(Math.min(...sampleSizes))} – ${formatNumber(Math.max(...sampleSizes))}`
      : t("contradiction.sampleNone");

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <GitCompareArrows className="h-4 w-4 text-amber-700" />
            <span>{cluster.source_label}</span>
            <ArrowRight className="h-3.5 w-3.5 text-amber-600" />
            <span>{cluster.target_label}</span>
          </div>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 tabular-nums">
            {t("contradiction.score", {
              score: formatNumber(cluster.contradiction_score, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            })}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-amber-900/90">
          <span className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-0.5 border border-amber-200/80 tabular-nums">
            <Scale className="h-3 w-3 text-amber-700" />
            {sampleRange}
          </span>
          <span className="rounded bg-white/80 px-2 py-0.5 border border-amber-200/80">
            {t("contradiction.methodsPrefix")}{" "}
            {distinctMethods.length > 0 ? distinctMethods.join(", ") : t("common.dash")}
          </span>
        </div>
      </div>

      <div className={`grid gap-3 ${grouped.length >= 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
        {grouped.map(([dir, sides]) => {
          const style = DIRECTION_STYLE[dir];
          return (
            <div key={dir} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
              <div className="flex items-center justify-between">
                <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}>
                  {t(style.key)}
                </span>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {t("contradiction.studiesCount", { count: sides.length })}
                </span>
              </div>

              {sides.map((side) => (
                <div
                  key={side.relationship_id}
                  className={`rounded-lg border border-slate-200 border-l-4 ${style.border} bg-white p-2.5 text-xs shadow-2xs`}
                >
                  <button
                    type="button"
                    onClick={() => focusPaperDetail(side.paper_id)}
                    className="flex items-start gap-1.5 text-left font-semibold text-slate-900 hover:text-indigo-700"
                  >
                    <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                    <span className="line-clamp-2 leading-snug">{side.paper_title}</span>
                  </button>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <span>
                      {side.authors[0] ?? t("contradiction.noAuthor")} · {side.year ?? t("common.dash")} ·
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openPdfAtPage(
                          side.paper_id,
                          side.page_number,
                          side.quote_snippet,
                          side.paper_title,
                        )
                      }
                      title={t("pdfReader.openAtPage", { page: side.page_number })}
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-indigo-700 tabular-nums hover:border-indigo-300 hover:bg-indigo-50"
                    >
                      {t("common.pageShort", { page: side.page_number })}
                    </button>
                    <GroundingBadge
                      compact
                      status={side.grounding_status}
                      score={side.grounding_score}
                      note={side.grounding_note}
                    />
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">{t("contradiction.effectLabel")}</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {side.effect_size !== null
                          ? `${side.effect_metric ?? "β"} = ${formatNumber(side.effect_size, { maximumFractionDigits: 3 })}`
                          : t("common.dash")}
                      </span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">p:</span>{" "}
                      <span className="font-semibold text-slate-800">{side.p_value ?? t("common.dash")}</span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">{t("contradiction.sampleLabel")}</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {side.sample_size !== null ? formatNumber(side.sample_size) : t("common.dash")}
                      </span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100 truncate" title={side.statistical_method ?? undefined}>
                      <span className="text-slate-500">{t("contradiction.methodLabel")}</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {side.statistical_method ?? t("common.dash")}
                      </span>
                    </div>
                  </div>

                  {side.quote_snippet && (
                    <blockquote className="mt-2 border-l-2 border-slate-200 pl-2 text-[11px] italic text-slate-600">
                      “{side.quote_snippet}”
                    </blockquote>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
