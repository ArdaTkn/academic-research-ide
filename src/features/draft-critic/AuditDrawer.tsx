import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Quote,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useI18n, type TranslationKey } from "@/i18n";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { AuditFinding, AuditFindingType, AuditOverallStatus, AuditResult } from "@/types/contracts";

const STATUS_STYLE: Record<AuditOverallStatus, { key: TranslationKey; cls: string }> = {
  supported: { key: "audit.status.supported", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  warning: { key: "audit.status.warning", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  contradicted: { key: "audit.status.contradicted", cls: "border-rose-200 bg-rose-50 text-rose-800" },
  unsupported: { key: "audit.status.unsupported", cls: "border-orange-200 bg-orange-50 text-orange-800" },
};

const FINDING_META: Record<AuditFindingType, { key: TranslationKey; border: string; badge: string }> = {
  contradiction: {
    key: "audit.finding.contradiction",
    border: "border-l-rose-500",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
  },
  unsupported_claim: {
    key: "audit.finding.unsupported_claim",
    border: "border-l-orange-500",
    badge: "bg-orange-50 text-orange-800 border-orange-200",
  },
  missing_citation: {
    key: "audit.finding.missing_citation",
    border: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
  },
  supporting_evidence: {
    key: "audit.finding.supporting_evidence",
    border: "border-l-emerald-500",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  style_deviation: {
    key: "audit.finding.style_deviation",
    border: "border-l-indigo-500",
    badge: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
};

interface AuditDrawerProps {
  activeParagraphIndex: number;
  activeParagraphText: string;
  auditResult: AuditResult | null;
  isAuditing: boolean;
  auditError: string | null;
  onAudit: (forceRefresh: boolean) => void;
  onDismissFinding: (finding: AuditFinding) => void;
}

export function AuditDrawer({
  activeParagraphIndex,
  activeParagraphText,
  auditResult,
  isAuditing,
  auditError,
  onAudit,
  onDismissFinding,
}: AuditDrawerProps) {
  const { t } = useI18n();
  const focusPaperDetail = useWorkspaceStore((s) => s.focusPaperDetail);
  const openPdfAtPage = useWorkspaceStore((s) => s.openPdfAtPage);
  const [showDismissed, setShowDismissed] = useState(false);

  const visibleFindings = (auditResult?.findings ?? []).filter(
    (f) => showDismissed || !f.is_dismissed
  );
  const dismissedCount = (auditResult?.findings ?? []).filter((f) => f.is_dismissed).length;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("audit.title")}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {t("audit.selectedParagraph", { index: activeParagraphIndex + 1 })}
            </p>
          </div>

          <button
            type="button"
            disabled={isAuditing || !activeParagraphText.trim()}
            onClick={() => onAudit(Boolean(auditResult))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-indigo-700 disabled:opacity-50"
          >
            {isAuditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>{auditResult ? t("audit.reaudit") : t("audit.audit")}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {auditError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{auditError}</span>
          </div>
        )}

        {!activeParagraphText.trim() ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
            {t("audit.emptyEditor")}
          </div>
        ) : !auditResult ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
            <ShieldAlert className="mx-auto mb-2 h-7 w-7 text-slate-300" />
            <p className="font-medium text-slate-700">
              {t("audit.notAuditedTitle", { index: activeParagraphIndex + 1 })}
            </p>
            <p className="mt-1">{t("audit.notAuditedSubtitle")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    STATUS_STYLE[auditResult.overall_status].cls
                  }`}
                >
                  {auditResult.overall_status === "supported" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  {t(STATUS_STYLE[auditResult.overall_status].key)}
                </span>
                <span className="font-mono text-[10px] text-slate-400">{auditResult.model_used}</span>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <span className="text-slate-500">{t("audit.coverage")}</span>{" "}
                  <strong className="text-slate-900">
                    {Math.round(auditResult.evidence_coverage_score * 100)}%
                  </strong>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                  <span className="text-slate-500">{t("audit.styleFit")}</span>{" "}
                  <strong className="text-slate-900">
                    {Math.round(auditResult.style_alignment_score * 100)}%
                  </strong>
                </div>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{auditResult.summary}</p>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wide text-slate-500">
                {t("audit.findingsHeading", { count: visibleFindings.length })}
              </span>
              {dismissedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDismissed((v) => !v)}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                >
                  {showDismissed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  <span>
                    {showDismissed
                      ? t("audit.hideDismissed")
                      : t("audit.showDismissed", { count: dismissedCount })}
                  </span>
                </button>
              )}
            </div>

            {visibleFindings.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-emerald-50/40 p-4 text-center text-xs text-emerald-800">
                <Sparkles className="mx-auto mb-1.5 h-5 w-5 text-emerald-600" />
                {t("audit.cleanParagraph")}
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleFindings.map((finding) => {
                  const meta = FINDING_META[finding.finding_type];
                  return (
                    <div
                      key={finding.id}
                      className={`rounded-xl border border-slate-200 border-l-4 ${meta.border} bg-white p-3 text-xs shadow-2xs ${
                        finding.is_dismissed ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
                          {t(meta.key)}
                        </span>
                        {finding.page_number !== null &&
                          (finding.related_paper_id ? (
                            <button
                              type="button"
                              onClick={() =>
                                openPdfAtPage(
                                  finding.related_paper_id!,
                                  finding.page_number!,
                                  finding.quote_snippet ?? finding.excerpt,
                                )
                              }
                              title={t("pdfReader.openAtPage", { page: finding.page_number })}
                              className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 tabular-nums hover:border-indigo-300 hover:bg-indigo-50"
                            >
                              {t("common.pageShort", { page: finding.page_number })}
                            </button>
                          ) : (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 tabular-nums">
                              {t("common.pageShort", { page: finding.page_number })}
                            </span>
                          ))}
                      </div>

                      <div className="mt-2 rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
                        “{finding.excerpt}”
                      </div>

                      <p className="mt-2 leading-relaxed text-slate-800">{finding.explanation}</p>

                      {finding.quote_snippet && (
                        <blockquote className="mt-2 flex items-start gap-1.5 border-l-2 border-indigo-200 pl-2 text-[11px] italic text-slate-600">
                          <Quote className="mt-0.5 h-3 w-3 shrink-0 text-indigo-400" />
                          <span>{finding.quote_snippet}</span>
                        </blockquote>
                      )}

                      {finding.suggestion && (
                        <p className="mt-2 rounded bg-indigo-50/50 px-2.5 py-1.5 text-[11px] text-indigo-900">
                          {finding.suggestion}
                        </p>
                      )}

                      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                        {finding.related_paper_id ? (
                          <button
                            type="button"
                            onClick={() => focusPaperDetail(finding.related_paper_id)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:text-indigo-900"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            <span>{t("audit.inspectSourcePaper")}</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">{t("audit.noMatchingPaper")}</span>
                        )}

                        <button
                          type="button"
                          onClick={() => onDismissFinding(finding)}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        >
                          {finding.is_dismissed ? t("audit.restore") : t("audit.dismiss")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
