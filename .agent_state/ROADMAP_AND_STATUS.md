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

- **Aktif Faz:** `Faz 0–5B Tamamlandı (Standalone Masaüstü Uygulaması + Çok Dilli i18n EN/TR)`
- **Son Güncelleyen Ajan:** `[Agent-Architect]`, `[Agent-Backend-NLP]`, `[Agent-Frontend-Core]`, `[Agent-QA-Reviewer]`
- **Tarih:** `2026-11-24`
- **Sıradaki İlk Adım:** Tüm fazlar (Faz 0–5B) tamamlandı ve doğrulandı; çift tıklamayla açılan standalone masaüstü paketi ve GitHub deposu güncel.

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

### Faz 5 — Çok Dilli Destek (i18n EN/TR) & İngilizce Açık Kaynak Standardı (`[Agent-Architect]`, `[Agent-Backend-NLP]`, `[Agent-Frontend-Core]`, `[Agent-Graph-Vis]`, `[Agent-Editor-Critic]`, `[Agent-QA-Reviewer]`)
- [x] Backend i18n: `backend/app/core/i18n.py` (`en`/`tr` katalog ve CSV başlıkları), `config.py` (`ui_locale` kalıcılığı), `errors.py` (`Accept-Language` middleware ve yerelleştirilmiş `ApiError`), `graph_service.py` (boşluk gerekçeleri), `style_service.py` (stil özetleri) ve `critic_service.py` (dil anahtarlı önbellek, özgün makale başlıkları/alıntılar korunarak yerelleştirilmiş bulgular ve sıfır uydurma atıf garantisi).
- [x] Frontend i18n: `src/i18n/{en,tr,index}.ts` (birebir anahtar/parametre eşitliği ve yerelleştirilmiş sayı/tarih biçimleme), `useWorkspaceStore` + `localStorage` + `/api/v1/config` senkronizasyonu, `TopNavBar` (`EN / TR` canlı geçiş) ve `SettingsModal`, `IngestionSidebar`, `PaperDetailDrawer`, Sekme 1 (`graph-map/*`), Sekme 2 (`ScaleMatrixTab`), Sekme 3 (`draft-critic/*`) ile `client.ts`/`sse.ts` tam yerelleştirildi.
- [x] Açık Kaynak İngilizce Dokümantasyon & Sözleşme Güncellemesi: Kök `README.md` (İngilizce, `English | Türkçe` geçişli) ve `README.tr.md` göreli yollarla yazıldı; `SCHEMA_AND_CONTRACTS.md`, `DECISION_LOG.md` (`ADR-015`) ve `.env.example` güncellendi.
- [x] `[Agent-QA-Reviewer]` i18n & Final QA: Backend `pytest` 19/19 (`test_i18n_localization.py` dahil), Frontend `tsc --noEmit` (0 hata) + Vitest 14/14 (5 test dosyası, `i18n.test.tsx` dahil) + `vite build`, Tauri `cargo check` ve açık kaynak hijyen denetimi (0 kişisel yol/veritabanı/gizli anahtar sızıntısı) geçti.

### Faz 5B — Standalone Masaüstü Paketleme (PyInstaller Sidecar, Tauri v2 Bundle & Başlangıç Hazırlık Kapısı) (`[Agent-Architect]`, `[Agent-Backend-NLP]`, `[Agent-Frontend-Core]`, `[Agent-QA-Reviewer]`)
- [x] PyInstaller Standalone Sidecar (`backend/sidecar_main.py`, `backend/sidecar.spec`, `backend/app/db/sqlite.py` `_MEIPASS` şema çözünürlüğü, `scripts/build_sidecar.py`, `scripts/smoke_test_sidecar.py`): `FastAPI`, `SQLite/FTS5`, `LanceDB`, `PyMuPDF`, `pdfplumber` bağımlılıklarını tek ikili (`src-tauri/binaries/research-ide-backend-<target_triple>`) olarak derler ve `.gitignore` ile repo dışında tutar.
- [x] Tauri v2 Sidecar & Üretim Paketi (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/icons/`): Hem geliştirme (`.venv`) hem üretim (`externalBin` sidecar) modları, Windows `CREATE_NO_WINDOW`, boş port seçimi, `PYTHONUTF8=1` + `app_data_dir()`, stdout/stderr tanılama günlüğü (`get_backend_diagnostics`, `restart_backend`) ve kapanışta kesin süreç/süreç-ağacı sonlandırma (`SIGTERM`/`SIGKILL` ve `taskkill /T /F`) sağlandı.
- [x] Ön Yüz Başlangıç Kapısı (`src/components/StartupReadinessGate.tsx`, `src/App.tsx`): `/api/v1/health` hazır olana kadar iki dilli (`en`/`tr`) hazırlık ekranı, başarısızlıkta log görüntüleyici ve tek tıkla "Yeniden Dene & Arka Ucu Başlat" akışı eklendi.
- [x] `[Agent-QA-Reviewer]` Standalone Doğrulama: PyInstaller build (`231.5 MiB` `research-ide-backend-aarch64-apple-darwin`) + `smoke_test_sidecar.py` (`exit 0`, `/health` + PyMuPDF + temiz SIGTERM), `pytest` (19/19), `tsc --noEmit` (0 hata) + Vitest (16/16, 6 dosya; `StartupReadinessGate.test.tsx` dahil) + `vite build`, `cargo check` ve gerçek macOS üretim derlemesi (`Academic Research IDE.app` `241.59 MiB` ve `Academic Research IDE_0.1.0_aarch64.dmg` `233.98 MiB`) doğrulandı.
- [x] `[Agent-QA-Reviewer]` Üretim `.app` Başlangıç Kök Neden Düzeltmesi (`ADR-017`): `useI18n()` memoizasyonu (`useCallback`), `StartupReadinessGate` efekt iptal döngüsünün giderilmesi + anlık `stderr` hata görünürlüğü + `45_000` ms soğuk başlangıç toleransı, `CORSMiddleware` (`tauri://localhost`) ve `pymupdf` temiz içe aktarımı sonrasında Vitest (`18/18`), `pytest` (`19/19`), `cargo check`, `smoke_test_sidecar.py`, yeniden derlenen `Academic Research IDE.app` (`241.62 MiB`) / `.dmg` (`234.00 MiB`) ve canlı `.app` başlangıç + temiz kapanma testi (`10.74s` içinde `/api/v1/health` 200 OK, çıkışta `0` artık süreç) başarıyla doğrulandı.
- [x] Varsayılan Karanlık Mod (`ADR-018`): `index.html`, `useWorkspaceStore`, `globals.css`, `GraphMapTab`, `TopNavBar`, `StartupReadinessGate` ve `SettingsModal` karanlık mod standart olacak ve istenirse tek tıkla aydınlık moda geçilebilecek şekilde güncellendi; `typecheck` (0 hata), Vitest (`18/18`), `vite build`, `pytest` (`19/19`) ve macOS `.app`/`.dmg` derlemesi doğrulandı.

### Faz 6 — Sayfa & Alıntı Doğrulama (Grounding Check) & Gömülü Split-View PDF Görüntüleyici (`[Agent-Backend-NLP]`, `[Agent-Frontend-Core]`, `[Agent-Graph-Vis]`, `[Agent-Editor-Critic]`, `[Agent-QA-Reviewer]`)
- [x] Backend Grounding Check (`backend/app/pipeline/grounding.py`, `worker.py`, `sqlite.py`, `graph_service.py`, `matrix.py`, `schemas.py`, `schema.sql`, `sidecar.spec`): Çıkarılan `Claim`, `Relationship` ve `Scale` kayıtlarındaki `quote_snippet` ve `page_number` alanları PyMuPDF ile çıkarılan sayfa metinleriyle deterministik olarak karşılaştırılıp `"verified"` / `"partial"` / `"unverified"`, `grounding_score` ve `grounding_note` ile işaretlendi; eski veritabanları için idempotent `_ensure_grounding_columns` migrasyonu ve `/matrix/scales` + `/matrix/export` için `grounding_status` filtresi eklendi (`ADR-019`).
- [x] Gömülü PDF Görüntüleyici API & Ön Yüz (`backend/app/api/papers.py`, `errors.py`, `i18n.py`; `src/components/PdfReaderPanel.tsx`, `src/components/GroundingBadge.tsx`, `src/App.tsx`, `src/stores/useWorkspaceStore.ts`, `src/i18n/{en,tr}.ts`): `/api/v1/papers/{paper_id}/file` ve `/api/v1/papers/{paper_id}/page-render` (PyMuPDF PNG base64 + normalize alıntı vurgulama koordinatları + `PDF_FILE_MISSING` / `PDF_PAGE_OUT_OF_RANGE` i18n hata kodları) eklendi; Split-View sağ PDF paneli `PaperDetailDrawer`, `ContradictionComparisonPanel`, `AuditDrawer` ve `ScaleMatrixTab` içindeki tıklanabilir `p. X` düğmelerine bağlandı ve karanlık/aydınlık mod ile EN/TR uyumu sağlandı.
- [x] `[Agent-QA-Reviewer]` Faz 6 Doğrulama: Backend `pytest` **22/22** (`test_grounding_and_pdf_reader.py` ve `test_schema_sql_matches_contracts_md` dahil), Frontend `tsc --noEmit` (**0 hata**), Vitest **21/21** (7 test dosyası; `PdfReaderPanel.test.tsx` ve `i18n.test.tsx` 1:1 anahtar/parametre eşitliği dahil), `vite build` ve Tauri `cargo check` başarıyla geçti.
