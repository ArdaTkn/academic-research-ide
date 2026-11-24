# ROADMAP_AND_STATUS.md — Faz Planı ve Canlı İlerleme Durumu

> **Proje:** Academic Research IDE  
> **Kök Dizin:** `academic-research-ide/`

---

## 1. Oturum Başlangıç ve Bitiş Protokolü (ZORUNLU KURAL)

1. **Oturum Başlangıcı:** Yeni bir LLM modeli veya oturum başladığında **ilk iş** `.agent_state/` altındaki 3 dosyayı (`ROADMAP_AND_STATUS.md`, `SCHEMA_AND_CONTRACTS.md`, `DECISION_LOG.md`) oku ve kaldığın yeri özetle.
2. **Oturum İçi Güncelleme:** Her büyük kod bloğu, modül veya dosya değişikliğinden sonra kod yazmayı durdur; ilgili görevleri `[x]` / `[/]` olarak işaretle, şema/kontrat değiştiyse `SCHEMA_AND_CONTRACTS.md` dosyasını, mimari karar alındıysa `DECISION_LOG.md` dosyasını güncelle.
3. **Sahiplik Sınırı:** Her alt ajan yalnızca kendi sorumlu olduğu dizinlerdeki dosyaları düzenler.

---

## 2. Mevcut Durum Özeti

- **Aktif Faz:** `Tüm Fazlar Tamamlandı (Faz 0–4 Final QA Onaylı)`
- **Son Güncelleyen Ajan:** `[Agent-Editor-Critic]`, `[Agent-Backend-NLP]` & `[Agent-QA-Reviewer]`
- **Tarih:** `2026-11-24`
- **Sıradaki İlk Adım:** Tüm çekirdek modüller (Ingestion/Parser, Sekme 1, Sekme 2, Sekme 3) ve Tauri v2 kabuğu tamamlanıp doğrulandı; uygulama `npm run tauri dev` veya geliştirme sunucusuyla çalıştırılmaya hazır.

---

## 3. Multi-Agent Rol & Dosya Sahipliği Matrisi

| Ajan Rolü | Sorumluluk Alanı | Yetkili Dizinler |
|---|---|---|
| `[Agent-Architect]` | Proje iskeleti, şema, API sözleşmeleri, `.agent_state/` yönetimi | `.agent_state/`, kök dizin yapılandırması |
| `[Agent-Backend-NLP]` | FastAPI servisi, SQLite/LanceDB, PDF çıkarımı, LLM structured extraction, analitik servisler | `backend/app/`, `backend/pyproject.toml` |
| `[Agent-Frontend-Core]` | Tauri v2 + React/TS kabuğu, navigasyon, makale yükleme/havuz paneli, **Sekme 2 (Ölçek & Yöntem Matrisi)** | `src-tauri/`, `src/api/`, `src/components/`, `src/stores/`, `src/types/`, `src/features/ingestion/`, `src/features/scale-matrix/` |
| `[Agent-Graph-Vis]` | **Sekme 1 (Kavram, Boşluk & Çelişki Haritası)** grafik ve kıyaslama bileşenleri | `src/features/graph-map/` |
| `[Agent-Editor-Critic]` | **Sekme 3 (Taslak Editörü, Stil Profili & Kanıt/Çelişki Denetçisi)** bileşenleri | `src/features/draft-critic/` |
| `[Agent-QA-Reviewer]` | Kontrat doğrulama, birim/entegrasyon testleri, uç durum (bozuk PDF, eksik veri) testleri | `backend/tests/`, `src/**/__tests__/` |

---

## 4. Faz Planı (Faz 0 → Faz 4)

### Faz 0 — İskelet ve Sözleşme (`[Agent-Architect]`)
- [x] Proje kök dizini `academic-research-ide/` ve klasör iskeleti (`src-tauri/`, `src/`, `backend/`, `.agent_state/`) oluşturuldu.
- [x] `.agent_state/SCHEMA_AND_CONTRACTS.md` (SQLite DDL, LanceDB şeması, Pydantic v2, TypeScript tipleri, FastAPI endpoint sözleşmeleri) oluşturuldu ve SQLite DDL doğrulandı.
- [x] `.agent_state/ROADMAP_AND_STATUS.md` Faz 0–4 görev kırılımıyla oluşturuldu.
- [x] `.agent_state/DECISION_LOG.md` ilk mimari kararlarla (ADR-001..ADR-007) oluşturuldu.

### Faz 1 — Backend Çekirdeği, Veritabanı ve PDF Ingestion/Parser Pipeline (`[Agent-Backend-NLP]`, `[Agent-QA-Reviewer]`)
- [x] `backend/` içinde `uv` ile Python 3.12 (`3.12.13`) izole sanal ortamı (`uv python pin 3.12` + `uv venv`) ve `pyproject.toml` kurulumu (`fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, `pymupdf`, `pdfplumber`, `lancedb`, `pyarrow`, `openai`, `httpx`, `pytest`).
- [x] `backend/app/core/config.py` ve `errors.py`: Yapılandırma yönetimi (yerel Ollama/LM Studio & API ayarları, maskeli anahtar, DB yolları) ve standart `ApiError` hata yakalayıcıları.
- [x] `backend/app/models/schemas.py`: `SCHEMA_AND_CONTRACTS.md` Bölüm C ile birebir uyumlu Pydantic v2 modelleri.
- [x] `backend/app/db/schema.sql` & `sqlite.py`: WAL/FK/FTS5 kurulumu, atomik çıkarım kaydı ve CRUD/Matrix/Graph repository katmanı.
- [x] `backend/app/db/vector_store.py`: LanceDB `paper_chunks` ve `style_chunks` indeksleme/arama katmanı + `EmbeddingProvider` soyutlaması.
- [x] `backend/app/pipeline/pdf_extractor.py`: PyMuPDF birincil + pdfplumber tablo/yedek sayfa-korumalı çıkarım ve bozuk/taranmış/şifreli PDF hata yönetimi.
- [x] `backend/app/pipeline/llm_extractor.py`: `PaperExtractionPayload` yapılandırılmış JSON çıkarımı, sayfa sınırı doğrulaması ve yeniden deneme mantığı.
- [x] `backend/app/pipeline/normalizer.py`: Değişken kanonikleştirme (`normalized_key` + alias eşleştirme).
- [x] `backend/app/pipeline/worker.py`: Arka plan ingestion iş kuyruğu + SSE durum akışı.
- [x] `backend/app/api/`: `system`, `papers`, `graph`, `matrix` ve `drafts` yönlendiricileri (`app/main.py` içinde `/api/v1` altına bağlandı).
- [x] `[Agent-QA-Reviewer]` Faz 1 Testleri: 11/11 pytest testi geçti (şema DDL eşitliği, WAL/FTS5/LanceDB, bozuk/taranmış PDF, sayfa dışı/geçersiz alpha LLM çıktısı reddi, null metrik koruma, duplicate SHA-256, E2E ingest/SSE/matrix/graph/merge/delete).

### Faz 2 — Tauri v2 + React/TS Kabuk & Sekme 2: Ölçek ve Yöntem Matrisi (`[Agent-Frontend-Core]`, `[Agent-QA-Reviewer]`)
- [x] Tauri v2 + Vite + React + TypeScript (strict) + Tailwind CSS v4 kurulumu ve open-source `.gitignore` hijyeni.
- [x] `src-tauri/` & `backend/app/core/config.py`: Çoklu platform (Windows/macOS/Linux) standart uygulama veri dizini, UTF-8 zorlaması, Python FastAPI sidecar başlatma, dinamik port yönetimi ve temiz kapanma (graceful shutdown) yaşam döngüsü.
- [x] `src/types/contracts.ts`: `SCHEMA_AND_CONTRACTS.md` Bölüm D & E ile birebir eşleşen TypeScript tipleri.
- [x] `src/api/` ve `src/stores/`: Typed HTTP + `ApiClientError` zarfı + yeniden bağlanmalı/yoklama yedekli SSE istemcisi (`sse.ts`), TanStack Query ve sekmeler arası genişletilebilir Zustand deposu (`useWorkspaceStore.ts`).
- [x] Ana IDE Kabuğu: Sol makale havuzu/PDF yükleme çekmecesi (`IngestionSidebar.tsx` — sürükle-bırak, yerel yol ekleme, canlı SSE ilerleme), üst sekme çubuğu (`TopNavBar.tsx`), makale/ölçek detay çekmecesi (`PaperDetailDrawer.tsx`) ve yerel/API LLM ayarları modalı (`SettingsModal.tsx`).
- [x] **Sekme 2 (`src/features/scale-matrix/ScaleMatrixTab.tsx`):** `@tanstack/react-table` ile çoklu filtreli (arama, değişken, Cronbach's α aralığı, min. örneklem, istatistiksel yöntem, yıl) ve sıralanabilir Ölçek & Yöntem Matrisi + satır detay çekmecesi + gerçek CSV/JSON dışa aktarım.
- [x] `[Agent-QA-Reviewer]` Faz 2 Testleri: `tsc --noEmit` (0 hata), Vitest 5/5 (SSE yedekleme, null metrik koruması, filtre/CSV dışa aktarım, `ApiError`), `vite build`, `cargo check` ve backend `pytest` (12/12) geçti.

### Faz 3 — Sekme 1: Kavram, Boşluk & Çelişki Haritası (`[Agent-Graph-Vis]`, `[Agent-Backend-NLP]`, `[Agent-QA-Reviewer]`)
- [x] `backend/app/services/graph_service.py`: Kavram grafiği toplulaştırma, gerçek ilişki yoğunluğuna dayalı araştırma boşluğu (`gap_score`) hesaplama ve çelişki kümeleme (`ContradictionCluster` — örneklem, yöntem fallback, etki büyüklüğü, sayfa referansı) servisi.
- [x] `src/features/graph-map/`: `@xyflow/react` + `@dagrejs/dagre` (`layout.ts`, `ConceptNode.tsx`, `GraphMapTab.tsx`) ile memoize edilmiş düğüm/kenar görselleştirme (yön renk kodları: `+`, `−`, `n.s.`, çelişkili; çalışma sayısına göre etiketleme ve izole düğüm yerleşimi).
- [x] Araştırma Boşluğu (Research Gap) katmanı: Doğrudan test edilmemiş veya az çalışılmış yüksek ortak-komşulu kavram çiftlerini kesikli mavi kenarlarla vurgulama ve boşluk listesi paneli.
- [x] Çelişki Kıyaslama Paneli (`ContradictionComparisonPanel.tsx`): Zıt bulgulu makaleleri etki yönü, örneklem (N), istatistiksel yöntem, etki büyüklüğü, p-değeri, sayfa referansı ve alıntılarla yan yana kıyaslama + `PaperDetailDrawer` bağlantısı.
- [x] Değişken Birleştirme (`VariableMergeModal.tsx`) + `useWorkspaceStore` üzerinden Sekme 2'ye geçiş (`focusVariableInMatrix`).
- [x] `[Agent-QA-Reviewer]` Faz 3 Testleri: Backend `pytest` 15/15 (izole düğüm, döngü, boşluklar, birleştirme sonrası tutarlılık, 60 düğüm/180 kenar performans) ve Frontend Vitest 9/9 + `tsc` + `vite build` + `cargo check` geçti.

### Faz 4 — Sekme 3: Taslak Editörü, Stil Profili & Kanıt/Çelişki Denetçisi + Final QA (`[Agent-Editor-Critic]`, `[Agent-Backend-NLP]`, `[Agent-QA-Reviewer]`)
- [x] `backend/app/services/style_service.py`: Kullanıcının geçmiş metinlerinden/PDF'lerinden stil profili çıkarma (cümle uzunluğu, edilgenlik, hedging/geçiş ifadeleri, atıf biçimi, ton, `style_chunks` vektörleme) ve `PATCH /style-profiles/{id}/activate`.
- [x] `backend/app/services/critic_service.py`: Paragraf bazlı hibrit kanıt/çelişki çapraz kontrol motoru (SQLite `relationships`/`claims` + LanceDB `paper_chunks` + stil uyumu + havuz değişimine duyarlı önbellek + sıfır uydurma atıf garantisi).
- [x] `src/features/draft-critic/`: Odaklanılabilir Markdown editörü (`DraftCriticTab.tsx`, `paragraphs.ts`), stil profili yöneticisi (`StyleProfileModal.tsx`), debounced otomatik kayıt ve paragraf bazlı denetim tetikleyicisi (`Cmd/Ctrl + Enter`).
- [x] Sağ Denetim Çekmecesi (`AuditDrawer.tsx`): Çelişki, desteksiz iddia, eksik atıf, destekleyici kanıt ve stil sapması kartları; sayfa referansı, alıntı önizlemesi, `PaperDetailDrawer` bağlantısı ve bulgu kapatma (`dismiss`).
- [x] `[Agent-QA-Reviewer]` Uçtan Uca Final Doğrulama: Backend `pytest` 17/17, Frontend `tsc --noEmit` 0 hata + Vitest 12/12 + `vite build`, Tauri `cargo check` ve open-source hijyen denetimi (kişisel yol/veri sızıntısı yok) başarıyla geçti.
