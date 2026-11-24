import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/en";
import type { GroundingStatus } from "@/types/contracts";

interface GroundingBadgeProps {
  status?: GroundingStatus | null;
  score?: number | null;
  note?: string | null;
  compact?: boolean;
}

function formatGroundingNote(
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  note: string | null | undefined,
  score: number | null | undefined,
): string | null {
  if (!note) return null;
  const percent = score !== null && score !== undefined ? Math.round(score * 100) : 0;

  if (note === "exact_quote_match" || note === "scale_name_matched_on_page") {
    return t("grounding.note.exact_match");
  }
  if (note === "high_similarity_quote_match") {
    return t("grounding.note.fuzzy_match", { percent });
  }
  if (
    note === "partial_quote_match" ||
    note === "partial_scale_match" ||
    note === "no_quote_anchor_matched"
  ) {
    return t("grounding.note.partial_match", { percent });
  }
  if (
    note === "quote_not_found_on_page" ||
    note === "anchor_not_found_on_page" ||
    note === "scale_not_found_on_page"
  ) {
    return t("grounding.note.not_found_on_page", { percent });
  }
  if (note === "page_out_of_range") {
    return t("grounding.note.page_out_of_range");
  }
  if (
    note === "missing_quote_and_anchor" ||
    note === "missing_quote" ||
    note === "missing_quote_snippet"
  ) {
    return t("grounding.note.missing_quote");
  }
  if (note.startsWith("quote_found_on_other_page:")) {
    const page = note.split(":")[1] ?? "?";
    return t("grounding.note.found_on_other_page", { page });
  }
  return note;
}

export function GroundingBadge({ status, score, note, compact = false }: GroundingBadgeProps) {
  const { t } = useI18n();
  const effective: GroundingStatus = status ?? "unverified";

  const style =
    effective === "verified"
      ? {
          badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
          Icon: CheckCircle2,
          iconClass: "text-emerald-600",
          label: t("grounding.verified"),
        }
      : effective === "partial"
        ? {
            badge: "border-amber-200 bg-amber-50 text-amber-800",
            Icon: AlertTriangle,
            iconClass: "text-amber-600",
            label: t("grounding.partial"),
          }
        : {
            badge: "border-rose-200 bg-rose-50 text-rose-800",
            Icon: HelpCircle,
            iconClass: "text-rose-600",
            label: t("grounding.unverified"),
          };

  const formattedNote = formatGroundingNote(t, note, score);
  const scoreLabel =
    score !== null && score !== undefined
      ? t("grounding.score", { percent: Math.round(score * 100) })
      : null;
  const tooltip = [style.label, scoreLabel, formattedNote].filter(Boolean).join(" — ");

  const { Icon } = style;
  return (
    <span
      title={tooltip}
      data-grounding-status={effective}
      className={`inline-flex items-center gap-1 rounded border font-medium ${style.badge} ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Icon className={`shrink-0 ${style.iconClass} ${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} />
      <span>{style.label}</span>
      {!compact && score !== null && score !== undefined && (
        <span className="tabular-nums opacity-80">({Math.round(score * 100)}%)</span>
      )}
    </span>
  );
}
