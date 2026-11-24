import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Merge, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { useI18n } from "@/i18n";
import type { GraphNode } from "@/types/contracts";

interface VariableMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  defaultTargetId?: string | null;
}

export function VariableMergeModal({
  isOpen,
  onClose,
  nodes,
  defaultTargetId = null,
}: VariableMergeModalProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState<string>(defaultTargetId ?? "");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setTargetId(defaultTargetId ?? nodes[0]?.variable_id ?? "");
      setSelectedSources([]);
    }
  }, [isOpen, defaultTargetId, nodes]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.mergeVariables({
        source_variable_ids: selectedSources,
        target_variable_id: targetId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
      void queryClient.invalidateQueries({ queryKey: ["matrix"] });
      void queryClient.invalidateQueries({ queryKey: ["matrix-methods"] });
      void queryClient.invalidateQueries({ queryKey: ["papers"] });
      onClose();
    },
  });

  if (!isOpen) return null;

  const toggleSource = (vid: string) => {
    setSelectedSources((prev) =>
      prev.includes(vid) ? prev.filter((x) => x !== vid) : [...prev, vid]
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!targetId || selectedSources.length === 0) return;
    mutation.mutate();
  };

  const errText =
    mutation.error instanceof ApiClientError
      ? `${mutation.error.error_code}: ${mutation.error.message}`
      : mutation.isError
        ? t("merge.failed")
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Merge className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">{t("merge.title")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("merge.closeAria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <p className="text-slate-600">{t("merge.description")}</p>

          <label className="block font-medium text-slate-700">
            {t("merge.targetLabel")}
            <select
              aria-label={t("merge.targetLabel")}
              value={targetId}
              onChange={(e) => {
                const nextTarget = e.target.value;
                setTargetId(nextTarget);
                setSelectedSources((prev) => prev.filter((id) => id !== nextTarget));
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              {nodes.map((node) => (
                <option key={node.variable_id} value={node.variable_id}>
                  {node.display_label} ({t("graph.node.papers", { count: node.paper_count })})
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="mb-1.5 font-medium text-slate-700">
              {t("merge.sourcesLabel", { count: selectedSources.length })}
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
              {nodes
                .filter((n) => n.variable_id !== targetId)
                .map((node) => {
                  const checked = selectedSources.includes(node.variable_id);
                  return (
                    <label
                      key={node.variable_id}
                      className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-white"
                    >
                      <span className="flex items-center gap-2 text-slate-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSource(node.variable_id)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>{node.display_label}</span>
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {t("graph.node.papers", { count: node.paper_count })}
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>

          {errText && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{errText}</div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !targetId || selectedSources.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
              <span>{t("merge.submit")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
