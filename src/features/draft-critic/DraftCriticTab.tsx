import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { AuditDrawer } from "@/features/draft-critic/AuditDrawer";
import {
  findParagraphIndexAtOffset,
  splitMarkdownParagraphs,
} from "@/features/draft-critic/paragraphs";
import { StyleProfileModal } from "@/features/draft-critic/StyleProfileModal";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { AuditFinding, AuditOverallStatus, AuditResult } from "@/types/contracts";

const PILL_STATUS: Record<AuditOverallStatus, string> = {
  supported: "border-emerald-300 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  contradicted: "border-rose-300 bg-rose-50 text-rose-800",
  unsupported: "border-orange-300 bg-orange-50 text-orange-800",
};

export function DraftCriticTab() {
  const queryClient = useQueryClient();
  const selectedDraftId = useWorkspaceStore((s) => s.selectedDraftId);
  const setSelectedDraftId = useWorkspaceStore((s) => s.setSelectedDraftId);
  const activeParagraphIndex = useWorkspaceStore((s) => s.activeParagraphIndex);
  const setActiveParagraphIndex = useWorkspaceStore((s) => s.setActiveParagraphIndex);

  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isPreviewMode, setPreviewMode] = useState(false);
  const [isStyleModalOpen, setStyleModalOpen] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [newDraftTitle, setNewDraftTitle] = useState("");
  const [showNewDraftForm, setShowNewDraftForm] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);

  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: () => apiClient.getDrafts(),
  });

  const profilesQuery = useQuery({
    queryKey: ["style-profiles"],
    queryFn: () => apiClient.getStyleProfiles(),
  });

  const drafts = draftsQuery.data ?? [];

  // İlk açılışta mevcut ilk taslağı otomatik seç
  useEffect(() => {
    if (!selectedDraftId && drafts.length > 0) {
      setSelectedDraftId(drafts[0].id);
    }
  }, [selectedDraftId, drafts, setSelectedDraftId]);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.id === selectedDraftId) ?? null,
    [drafts, selectedDraftId]
  );

  useEffect(() => {
    if (activeDraft && loadedDraftIdRef.current !== activeDraft.id) {
      loadedDraftIdRef.current = activeDraft.id;
      setTitle(activeDraft.title);
      setMarkdown(activeDraft.content_markdown);
      setIsDirty(false);
      setAuditError(null);
    } else if (!activeDraft && drafts.length === 0) {
      loadedDraftIdRef.current = null;
      setTitle("");
      setMarkdown("");
      setIsDirty(false);
    }
  }, [activeDraft, drafts.length]);

  const auditsQuery = useQuery({
    queryKey: ["draft-audits", selectedDraftId],
    queryFn: () => apiClient.getDraftAudits(selectedDraftId!),
    enabled: Boolean(selectedDraftId),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { draftId: string; title: string; content_markdown: string }) =>
      apiClient.updateDraft(payload.draftId, {
        title: payload.title,
        content_markdown: payload.content_markdown,
      }),
    onSuccess: (updated) => {
      setIsDirty(false);
      queryClient.setQueryData(["drafts"], (prev: typeof drafts | undefined) =>
        (prev ?? []).map((d) => (d.id === updated.id ? updated : d))
      );
    },
  });

  // 800ms debounced otomatik kayıt
  useEffect(() => {
    if (!isDirty || !selectedDraftId) return;
    const timer = setTimeout(() => {
      saveMutation.mutate({
        draftId: selectedDraftId,
        title: title.trim() || "Adsız Taslak",
        content_markdown: markdown,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [isDirty, selectedDraftId, title, markdown]);

  const createDraftMutation = useMutation({
    mutationFn: (draftTitle: string) =>
      apiClient.createDraft({
        title: draftTitle.trim() || "Yeni Araştırma Taslağı",
        content_markdown: "",
      }),
    onSuccess: (created) => {
      setShowNewDraftForm(false);
      setNewDraftTitle("");
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
      loadedDraftIdRef.current = null;
      setSelectedDraftId(created.id);
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (draftId: string) => apiClient.deleteDraft(draftId),
    onSuccess: (_res, deletedId) => {
      loadedDraftIdRef.current = null;
      if (selectedDraftId === deletedId) {
        setSelectedDraftId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const auditMutation = useMutation({
    mutationFn: (vars: { draftId: string; paragraphIndex: number; paragraphText: string; forceRefresh: boolean }) =>
      apiClient.auditDraftParagraph(vars.draftId, {
        paragraph_index: vars.paragraphIndex,
        paragraph_text: vars.paragraphText,
        force_refresh: vars.forceRefresh,
      }),
    onSuccess: (result) => {
      setAuditError(null);
      queryClient.setQueryData(["draft-audits", result.draft_id], (prev: AuditResult[] | undefined) => {
        const list = prev ?? [];
        const filtered = list.filter((r) => r.paragraph_index !== result.paragraph_index);
        return [...filtered, result].sort((a, b) => a.paragraph_index - b.paragraph_index);
      });
    },
    onError: (err) => {
      setAuditError(
        err instanceof ApiClientError ? `${err.error_code}: ${err.message}` : "Paragraf denetimi yürütülemedi."
      );
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (finding: AuditFinding) =>
      apiClient.dismissAuditFinding(finding.id, !finding.is_dismissed),
    onSuccess: (updatedFinding) => {
      queryClient.setQueryData(["draft-audits", selectedDraftId], (prev: AuditResult[] | undefined) =>
        (prev ?? []).map((res) =>
          res.id === updatedFinding.audit_result_id
            ? {
                ...res,
                findings: res.findings.map((f) => (f.id === updatedFinding.id ? updatedFinding : f)),
              }
            : res
        )
      );
    },
  });

  const paragraphs = useMemo(() => splitMarkdownParagraphs(markdown), [markdown]);
  const activeParagraph = paragraphs[activeParagraphIndex] ?? paragraphs[0] ?? null;
  const resolvedParagraphIndex = activeParagraph?.index ?? 0;

  const auditsByIndex = useMemo(() => {
    const map = new Map<number, AuditResult>();
    for (const r of auditsQuery.data ?? []) {
      map.set(r.paragraph_index, r);
    }
    return map;
  }, [auditsQuery.data]);

  const activeAudit = auditsByIndex.get(resolvedParagraphIndex) ?? null;
  const activeProfile = (profilesQuery.data ?? []).find((p) => p.is_active) ?? null;

  const handleTriggerAudit = (forceRefresh = false) => {
    if (!selectedDraftId || !activeParagraph) return;
    auditMutation.mutate({
      draftId: selectedDraftId,
      paragraphIndex: activeParagraph.index,
      paragraphText: activeParagraph.text,
      forceRefresh,
    });
  };

  const syncCursorParagraph = () => {
    const el = textareaRef.current;
    if (!el || paragraphs.length === 0) return;
    const idx = findParagraphIndexAtOffset(paragraphs, el.selectionStart ?? 0);
    if (idx !== activeParagraphIndex) {
      setActiveParagraphIndex(idx);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Üst Taslak ve Stil Araç Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Taslak seçin"
            value={selectedDraftId ?? ""}
            onChange={(e) => {
              loadedDraftIdRef.current = null;
              setSelectedDraftId(e.target.value || null);
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
          >
            {drafts.length === 0 && <option value="">Taslak Yok</option>}
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowNewDraftForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-indigo-600" />
            <span>Yeni Taslak</span>
          </button>

          {selectedDraftId && (
            <button
              type="button"
              onClick={() => deleteDraftMutation.mutate(selectedDraftId)}
              disabled={deleteDraftMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
              title="Seçili taslağı sil"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setStyleModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100/70"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Stil: {activeProfile ? activeProfile.name : "Tanımla"}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {selectedDraftId && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Kaydediliyor...
                </>
              ) : isDirty ? (
                "Değişiklikler bekliyor"
              ) : (
                <>
                  <Check className="h-3 w-3 text-emerald-600" /> Kaydedildi
                </>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={() => setPreviewMode((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {isPreviewMode ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            <span>{isPreviewMode ? "Düzenle" : "Önizleme"}</span>
          </button>

          <button
            type="button"
            disabled={!selectedDraftId || !activeParagraph || auditMutation.isPending}
            onClick={() => handleTriggerAudit(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-indigo-700 disabled:opacity-50"
          >
            {auditMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            <span>Paragrafı Denetle</span>
          </button>
        </div>
      </div>

      {showNewDraftForm && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-indigo-50/40 px-5 py-2.5 text-xs">
          <input
            type="text"
            value={newDraftTitle}
            onChange={(e) => setNewDraftTitle(e.target.value)}
            placeholder="Yeni taslak başlığı (örn. Bulgular ve Tartışma)..."
            className="w-80 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => createDraftMutation.mutate(newDraftTitle)}
            disabled={createDraftMutation.isPending}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
          >
            Oluştur
          </button>
          <button
            type="button"
            onClick={() => setShowNewDraftForm(false)}
            className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-200"
          >
            İptal
          </button>
        </div>
      )}

      {/* Ana Editör + Sağ Denetim Çekmecesi */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          {draftsQuery.isLoading ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
              Taslaklar yükleniyor...
            </div>
          ) : !selectedDraftId ? (
            <div className="mx-auto my-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <FileText className="mx-auto mb-3 h-9 w-9 text-slate-300" />
              <div className="text-sm font-semibold text-slate-900">Henüz aktif bir taslak yok</div>
              <p className="mt-1 text-xs text-slate-500">
                Akademik metninizi yazmaya başlamak ve yerel makale havuzuna karşı denetlemek için yeni bir taslak
                oluşturun.
              </p>
              <button
                type="button"
                onClick={() => createDraftMutation.mutate("İlk Araştırma Taslağım")}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>İlk Taslağı Oluştur</span>
              </button>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3">
              <input
                type="text"
                aria-label="Taslak başlığı"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setIsDirty(true);
                }}
                placeholder="Taslak başlığı..."
                className="border-b border-slate-200 bg-transparent pb-2 text-xl font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none"
              />

              {/* Paragraf Gezgini */}
              {paragraphs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">Paragraflar:</span>
                  {paragraphs.map((p) => {
                    const audit = auditsByIndex.get(p.index);
                    const isActive = p.index === resolvedParagraphIndex;
                    const statusCls = audit
                      ? PILL_STATUS[audit.overall_status]
                      : "border-slate-200 bg-white text-slate-600";
                    return (
                      <button
                        key={p.index}
                        type="button"
                        onClick={() => setActiveParagraphIndex(p.index)}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition ${statusCls} ${
                          isActive ? "ring-2 ring-indigo-400" : ""
                        }`}
                      >
                        P{p.index + 1} ({p.wordCount}k)
                      </button>
                    );
                  })}
                </div>
              )}

              {isPreviewMode ? (
                <div className="flex-1 space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-800 shadow-2xs">
                  {paragraphs.length === 0 ? (
                    <p className="text-slate-400">Önizlenecek içerik yok.</p>
                  ) : (
                    paragraphs.map((p) => {
                      const audit = auditsByIndex.get(p.index);
                      const isActive = p.index === resolvedParagraphIndex;
                      return (
                        <div
                          key={p.index}
                          onClick={() => setActiveParagraphIndex(p.index)}
                          className={`cursor-pointer rounded-lg border p-3 transition ${
                            isActive ? "border-indigo-300 bg-indigo-50/30" : "border-transparent hover:bg-slate-50"
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                            <span>PARAGRAF {p.index + 1}</span>
                            {audit && <span>{audit.overall_status.toUpperCase()}</span>}
                          </div>
                          <p className="whitespace-pre-wrap">{p.text}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  aria-label="Markdown taslak editörü"
                  value={markdown}
                  onChange={(e) => {
                    setMarkdown(e.target.value);
                    setIsDirty(true);
                    const nextParagraphs = splitMarkdownParagraphs(e.target.value);
                    const nextIdx = findParagraphIndexAtOffset(nextParagraphs, e.target.selectionStart ?? 0);
                    setActiveParagraphIndex(nextIdx);
                  }}
                  onClick={syncCursorParagraph}
                  onKeyUp={syncCursorParagraph}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleTriggerAudit(false);
                    }
                  }}
                  placeholder="Akademik metninizi Markdown biçiminde buraya yazın. Paragrafları boş satırla ayırın; seçili paragrafı Cmd/Ctrl + Enter ile denetleyebilirsiniz."
                  className="min-h-[460px] flex-1 resize-none rounded-xl border border-slate-200 bg-white p-5 font-sans text-sm leading-relaxed text-slate-900 shadow-2xs focus:border-indigo-500 focus:outline-none"
                />
              )}
            </div>
          )}
        </div>

        <AuditDrawer
          activeParagraphIndex={resolvedParagraphIndex}
          activeParagraphText={activeParagraph?.text ?? ""}
          auditResult={activeAudit}
          isAuditing={auditMutation.isPending}
          auditError={auditError}
          onAudit={handleTriggerAudit}
          onDismissFinding={(finding) => dismissMutation.mutate(finding)}
        />
      </div>

      <StyleProfileModal isOpen={isStyleModalOpen} onClose={() => setStyleModalOpen(false)} />
    </div>
  );
}
