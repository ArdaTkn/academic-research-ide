import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Save, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { apiClient, ApiClientError } from "@/api/client";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

export function SettingsModal() {
  const isOpen = useWorkspaceStore((s) => s.isSettingsOpen);
  const setOpen = useWorkspaceStore((s) => s.setSettingsOpen);
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => apiClient.getConfig(),
    enabled: isOpen,
  });

  const [llmProvider, setLlmProvider] = useState("ollama");
  const [llmBaseUrl, setLlmBaseUrl] = useState("http://127.0.0.1:11434/v1");
  const [llmModel, setLlmModel] = useState("qwen2.5:14b");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [embeddingProvider, setEmbeddingProvider] = useState("openai_compatible");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("BAAI/bge-small-en-v1.5");
  const [embeddingDim, setEmbeddingDim] = useState("384");
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (configQuery.data) {
      setLlmProvider(configQuery.data.llm_provider);
      setLlmBaseUrl(configQuery.data.llm_base_url);
      setLlmModel(configQuery.data.llm_model);
      setLlmApiKey("");
      setEmbeddingProvider(configQuery.data.embedding_provider);
      setEmbeddingBaseUrl(configQuery.data.embedding_base_url ?? "");
      setEmbeddingModel(configQuery.data.embedding_model);
      setEmbeddingDim(String(configQuery.data.embedding_dim));
      setSaveNotice(null);
    }
  }, [configQuery.data]);

  const mutation = useMutation({
    mutationFn: () => {
      const parsedDim = Number.parseInt(embeddingDim, 10);
      return apiClient.patchConfig({
        llm_provider: llmProvider.trim(),
        llm_base_url: llmBaseUrl.trim(),
        llm_model: llmModel.trim(),
        llm_api_key: llmApiKey.trim() ? llmApiKey.trim() : null,
        embedding_provider: embeddingProvider.trim(),
        embedding_base_url: embeddingBaseUrl.trim() ? embeddingBaseUrl.trim() : null,
        embedding_model: embeddingModel.trim(),
        embedding_dim: Number.isFinite(parsedDim) && parsedDim > 0 ? parsedDim : null,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["config"], updated);
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      setLlmApiKey("");
      setSaveNotice("Yapılandırma kaydedildi.");
    },
  });

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaveNotice(null);
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiClientError
      ? `${mutation.error.error_code}: ${mutation.error.message}`
      : mutation.isError
        ? "Ayarlar kaydedilemedi."
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Yerel & API Model Ayarları</h2>
            <p className="text-xs text-slate-500">
              Ayarlar kullanıcının işletim sistemi veri dizininde (`config.json`) saklanır.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {configQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Mevcut yapılandırma yükleniyor...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-700">
                  LLM Sağlayıcı
                  <select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ollama">Ollama (Yerel)</option>
                    <option value="lm_studio">LM Studio (Yerel)</option>
                    <option value="openai">OpenAI Uyumlu API</option>
                  </select>
                </label>

                <label className="block text-xs font-medium text-slate-700">
                  LLM Model Adı
                  <input
                    type="text"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                    required
                  />
                </label>
              </div>

              <label className="block text-xs font-medium text-slate-700">
                LLM Base URL (OpenAI Uyumlu)
                <input
                  type="url"
                  value={llmBaseUrl}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  required
                />
              </label>

              <label className="block text-xs font-medium text-slate-700">
                <span className="flex items-center justify-between">
                  <span>API Anahtarı (Yerel Ollama için boş bırakılabilir)</span>
                  {configQuery.data?.has_api_key && (
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      <KeyRound className="h-3 w-3" />
                      {configQuery.data.llm_api_key_masked}
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="Değiştirmek için yeni anahtar girin"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </label>

              <div className="border-t border-slate-200 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Embedding (Vektör Arama)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Sağlayıcı
                    <select
                      value={embeddingProvider}
                      onChange={(e) => setEmbeddingProvider(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="openai_compatible">OpenAI Uyumlu</option>
                      <option value="local_hash">Yerel Hash (Test)</option>
                    </select>
                  </label>

                  <label className="block text-xs font-medium text-slate-700">
                    Model
                    <input
                      type="text"
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-700">
                    Boyut
                    <input
                      type="number"
                      min={64}
                      value={embeddingDim}
                      onChange={(e) => setEmbeddingDim(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </label>
                </div>

                <label className="mt-2.5 block text-xs font-medium text-slate-700">
                  Embedding Base URL (Boşsa LLM Base URL kullanılır)
                  <input
                    type="text"
                    value={embeddingBaseUrl}
                    onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:11434/v1"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
            </>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {errorMessage}
            </div>
          )}
          {saveNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {saveNotice}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Kapat
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || configQuery.isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60"
            >
              {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>Kaydet</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
