import { ArrowRight, BookOpen, GitCompareArrows, Scale } from "lucide-react";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { ContradictionCluster, ContradictionPaperSide, RelationshipDirection } from "@/types/contracts";

const DIRECTION_STYLE: Record<RelationshipDirection, { label: string; badge: string; border: string }> = {
  positive: {
    label: "Pozitif (+)",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
    border: "border-l-emerald-500",
  },
  negative: {
    label: "Negatif (-)",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
    border: "border-l-rose-500",
  },
  insignificant: {
    label: "Anlamsız (n.s.)",
    badge: "bg-slate-100 text-slate-700 border-slate-300",
    border: "border-l-slate-400",
  },
  mixed: {
    label: "Karışık",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    border: "border-l-amber-500",
  },
  curvilinear: {
    label: "Eğrisel",
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
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);

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
        ? `N = ${sampleSizes[0]}`
        : `N = ${Math.min(...sampleSizes)} – ${Math.max(...sampleSizes)}`
      : "Örneklem bildirilmemiş";

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
            Skor: {cluster.contradiction_score.toFixed(2)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-amber-900/90">
          <span className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-0.5 border border-amber-200/80 tabular-nums">
            <Scale className="h-3 w-3 text-amber-700" />
            {sampleRange}
          </span>
          <span className="rounded bg-white/80 px-2 py-0.5 border border-amber-200/80">
            Yöntemler: {distinctMethods.length > 0 ? distinctMethods.join(", ") : "—"}
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
                  {style.label}
                </span>
                <span className="text-[11px] text-slate-500 tabular-nums">{sides.length} çalışma</span>
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

                  <div className="mt-1 text-[11px] text-slate-500">
                    {side.authors[0] ?? "Yazar yok"} · {side.year ?? "—"} ·{" "}
                    <span className="font-medium text-slate-700 tabular-nums">s. {side.page_number}</span>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">Etki:</span>{" "}
                      <span className="font-semibold text-slate-800">
                        {side.effect_size !== null
                          ? `${side.effect_metric ?? "β"} = ${side.effect_size}`
                          : "—"}
                      </span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">p:</span>{" "}
                      <span className="font-semibold text-slate-800">{side.p_value ?? "—"}</span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100">
                      <span className="text-slate-500">Örneklem N:</span>{" "}
                      <span className="font-semibold text-slate-800">{side.sample_size ?? "—"}</span>
                    </div>
                    <div className="rounded bg-slate-50 px-2 py-1 border border-slate-100 truncate" title={side.statistical_method ?? undefined}>
                      <span className="text-slate-500">Yöntem:</span>{" "}
                      <span className="font-semibold text-slate-800">{side.statistical_method ?? "—"}</span>
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
