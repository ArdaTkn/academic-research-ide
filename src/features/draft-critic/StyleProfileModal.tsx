import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { useI18n } from "@/i18n";

interface StyleProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StyleProfileModal({ isOpen, onClose }: StyleProfileModalProps) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [rawText, setRawText] = useState("");
  const [filePathsText, setFilePathsText] = useState("");

  const profilesQuery = useQuery({
    queryKey: ["style-profiles"],
    queryFn: () => apiClient.getStyleProfiles(),
    enabled: isOpen,
  });

  const extractMutation = useMutation({
    mutationFn: () => {
      const filePaths = filePathsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const rawTexts = rawText.trim() ? [rawText.trim()] : [];
      return apiClient.extractStyleProfile({
        name: name.trim(),
        file_paths: filePaths,
        raw_texts: rawTexts,
        set_active: true,
        locale,
      });
    },
    onSuccess: () => {
      setName("");
      setRawText("");
      setFilePathsText("");
      void queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (profileId: string) => apiClient.activateStyleProfile(profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
    },
  });

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (!rawText.trim() && !filePathsText.trim())) return;
    extractMutation.mutate();
  };

  const errMsg =
    extractMutation.error instanceof ApiClientError
      ? `${extractMutation.error.error_code}: ${extractMutation.error.message}`
      : extractMutation.isError
        ? t("style.extractFailed")
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{t("style.modalTitle")}</h2>
              <p className="text-[11px] text-slate-500">{t("style.modalSubtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("style.closeAria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("style.savedProfiles", { count: profilesQuery.data?.length ?? 0 })}
            </div>

            {profilesQuery.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("style.loading")}
              </div>
            ) : (profilesQuery.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-slate-500">
                {t("style.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {profilesQuery.data!.map((profile) => (
                  <div
                    key={profile.id}
                    className={`rounded-lg border p-3 ${
                      profile.is_active ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900">{profile.name}</div>
                      {profile.is_active ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                          <CheckCircle2 className="h-3 w-3" /> {t("style.activeBadge")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => activateMutation.mutate(profile.id)}
                          disabled={activateMutation.isPending}
                          className="rounded border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {t("style.setActive")}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{profile.system_prompt_summary}</p>
                    {profile.hedging_phrases.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {profile.hedging_phrases.slice(0, 6).map((h) => (
                          <span key={h} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <form onSubmit={handleSubmit} className="space-y-3 border-t border-slate-200 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {t("style.extractNew")}
            </div>

            <label className="block font-medium text-slate-700">
              {t("style.nameLabel")}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("style.namePlaceholder")}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                required
              />
            </label>

            <label className="block font-medium text-slate-700">
              {t("style.rawLabel")}
              <textarea
                rows={4}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={t("style.rawPlaceholder")}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </label>

            <label className="block font-medium text-slate-700">
              {t("style.filesLabel")}
              <textarea
                rows={2}
                value={filePathsText}
                onChange={(e) => setFilePathsText(e.target.value)}
                placeholder="samples/past_paper.md"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-[11px] text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </label>

            {errMsg && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{errMsg}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                {t("common.close")}
              </button>
              <button
                type="submit"
                disabled={extractMutation.isPending || !name.trim() || (!rawText.trim() && !filePathsText.trim())}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {extractMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{t("style.extractSubmit")}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
