# DECISION_LOG.md — Mimari Kararlar ve Değişiklik Günlüğü

> **Proje:** Academic Research IDE  
> **Format:** `[Tarih] [Faz] [ADR-ID] Başlık — Karar ve Gerekçe`

---

### [2026-11-24] [Faz 0] [ADR-001] Proje Kök Dizini ve Monorepo Düzeni
- **Karar:** Proje `academic-research-ide/` altında tek monorepo olarak yapılandırıldı: `src-tauri/` (Rust/Tauri v2), `src/` (React/TypeScript), `backend/` (Python/FastAPI), çalışma zamanında OS standart uygulama veri dizininde oluşturulan veri katmanı (`ADR-010`) ve `.agent_state/` (ajanlar arası bağlam koruma dosyaları).
- **Gerekçe:** Masaüstü kabuğu, ön yüz ve yerel NLP/veri arka ucunun tek sözleşme (`SCHEMA_AND_CONTRACTS.md`) etrafında eşzamanlı yönetilmesi ve model geçişlerinde dosya keşfinin deterministik olması.

### [2026-11-24] [Faz 0] [ADR-002] Tauri v2 + Yerel Python FastAPI Sidecar Mimarisi
- **Karar:** Masaüstü uygulaması Tauri v2 kabuğu içinde React/TS arayüzü sunar; veri işleme, PDF ayrıştırma, vektör arama ve LLM orkestrasyonu `127.0.0.1` üzerinde çalışan yerel bir Python FastAPI servisi (REST + SSE) üzerinden yürütülür.
- **Gerekçe:** PyMuPDF, pdfplumber, LanceDB ve embedding modelleri Python ekosisteminde olgun ve hızlıdır; Rust/Tauri kabuğu ise düşük bellek ayak izi ve güvenli yerel dosya sistemi erişimi sağlar.

### [2026-11-24] [Faz 0] [ADR-003] Hibrit Yerel Depolama: SQLite (WAL/FTS5) + LanceDB
- **Karar:** İlişkisel veriler (`papers`, `variables`, `relationships`, `scales`, `claims`, `drafts`, `audit_results`) için `PRAGMA journal_mode = WAL;` ve `PRAGMA foreign_keys = ON;` etkinleştirilmiş SQLite + FTS5; anlamsal paragraf/kanıt ve stil aramaları için gömülü LanceDB kullanılır.
- **Gerekçe:** Harici veritabanı sunucusu kurulumu gerektirmez, tamamen yerel (offline-first) çalışır ve tüm araştırma verisi `data/` klasöründen taşınabilir.

### [2026-11-24] [Faz 0] [ADR-004] Katmanlar Arası Tek Tip `snake_case` + UUIDv4 + ISO-8601 UTC
- **Karar:** SQLite sütunları, Pydantic v2 alanları, FastAPI JSON yanıtları ve TypeScript arayüzleri dahil tüm katmanlarda `snake_case` adlandırma, UUIDv4 birincil anahtarlar ve ISO-8601 UTC tarih damgaları kullanılır.
- **Gerekçe:** Farklı LLM modelleri ve alt ajanlar arasındaki geçişlerde alan adı uyumsuzluğunu (`camelCase` ↔ `snake_case`) tamamen ortadan kaldırır.

### [2026-11-24] [Faz 0] [ADR-005] PDF Çıkarım ve Yapılandırılmış LLM Çıktı Stratejisi
- **Karar:** PDF metin çıkarımında sayfa numarası korunarak `PyMuPDF` birincil motor, tablo yoğun sayfalar ve yedek okuma için `pdfplumber` kullanılır. LLM çıkarım katmanı OpenAI-uyumlu yapılandırılmış JSON arayüzünü soyutlar (yerel Ollama / LM Studio öncelikli, kullanıcı isterse harici API anahtarı ile çalışabilir).
- **Gerekçe:** Akademik taslak ve makalelerin gizliliğini yerel LLM desteğiyle korurken, şema doğrulamalı (`PaperExtractionPayload`) deterministik JSON çıktısı garanti edilir.

### [2026-11-24] [Faz 0] [ADR-006] Ön Yüz Kütüphane Seçimleri
- **Karar:** React + TypeScript (strict) + Vite + Tailwind CSS temel alınır. Sekme 1 için `@xyflow/react` + otomatik düzenleme (`dagre`/`elkjs`), Sekme 2 için `@tanstack/react-table`, durum yönetimi için Zustand + TanStack Query kullanılır. Sekme 3 Markdown editörü (CodeMirror 6 vs. TipTap) nihai seçimi Faz 4 başında netleştirilecektir.
- **Gerekçe:** Büyük kavram grafikleri ve çoklu filtreli veri matrisleri için kanıtlanmış, tip-güvenli bileşen ekosistemi.

### [2026-11-24] [Faz 0] [ADR-007] Kanonik Değişken Normalizasyonu ve `paper_variables` Ayrımı
- **Karar:** Kavramlar kanonik `variables` tablosunda (`canonical_name`, `normalized_key`, `aliases_json`) tekilleştirilir; bir makalede hangi rolde (`independent`, `dependent`, `mediator`, `moderator`, `control`, `outcome`) yer aldığı `paper_variables` ara tablosunda tutulur.
- **Gerekçe:** Aynı değişken bir makalede bağımsız, diğer makalede aracı değişken olabilir; ayrıca "Job Satisfaction" ve "Employee Satisfaction" gibi adlandırma farkları grafiği parçalamadan birleştirilebilir olmalıdır.

### [2026-11-24] [Faz 0] [ENV-NOTE] Geliştirme Ortamı Gözlemleri (Faz 1 İçin Not)
- **Gözlem:** Sistemde `Python 3.15.2`, `uv`, `Node v26.13.1`, `npm 11.20.0`, `bun`, `rustc 1.100.0`, `cargo 1.100.0` kurulu olduğu doğrulandı (`pnpm` kurulu değil).
- **Eylem Notu (Faz 1):** Python 3.15 çok yeni olduğu için `lancedb`, `pymupdf` veya `pydantic-core` C/Rust tekerlekleri (wheels) 3.15 için henüz mevcut olmayabilir. Faz 1 başında `[Agent-Backend-NLP]` `uv python pin 3.12` (veya `3.13`) ile sanal ortam oluşturarak derleme hatalarını önlemelidir.

### [2026-11-24] [Faz 1] [ADR-008] İzole Python 3.12 `uv` Ortamı ve Embedding Sağlayıcı Soyutlaması
- **Karar:** `backend/` altında sistem Python 3.15 ortamından tamamen izole şekilde `uv python pin 3.12` (`CPython 3.12.13`) ve `.venv` kuruldu. Vektör gömme katmanı `EmbeddingProvider` protokolüyle soyutlandı (`OpenAICompatibleEmbedder` çalışma zamanı için, `LocalHashEmbedder` çevrimdışı test/yedek kullanım için), ve tüm vektörler LanceDB `paper_chunks` / `style_chunks` tablolarında `float32[384]` olarak standardize edildi.
- **Gerekçe:** Büyük yerel ML paketleri indirmeden hızlı, deterministik test koşumu ve Ollama/LM Studio/OpenAI uyumlu `/embeddings` uç noktalarına esnek bağlanma sağlamak.

### [2026-11-24] [Faz 1] [ADR-009] Fail-Closed Çıkarım Kapısı ve `IngestionJob` / `ApiError` Hata Standardı
- **Karar:** PDF metin çıkarımı (`PDF_CORRUPTED`, `PDF_ENCRYPTED`, `PDF_NO_TEXT_SCANNED`) ve LLM yapılandırılmış çıkarımı (`PaperExtractionPayload` + sayfa numarası sınır denetimi `1 <= page_number <= page_count`) sıkı fail-closed kapıdan geçirilir. Doğrulamadan geçmeyen çıktı asla SQLite veya LanceDB'ye yazılmaz; tüm hatalar `IngestionJob.error_detail`, `papers.ingestion_error` ve `ApiError` zarfı üzerinden şeffaf biçimde raporlanır.
- **Gerekçe:** Akademik araştırmalarda sahte sayfa referansı, uydurulmuş Cronbach's alpha veya kısmi bozuk kayıt birikimini tamamen önlemek.

### [2026-11-24] [Faz 2] [ADR-010] Çoklu Platform Kullanıcı Veri Dizini ve Open-Source Hijyeni
- **Karar:** Kullanıcı verileri (SQLite veritabanı, LanceDB vektörleri, yüklenen PDF'ler, `config.json`) repo dizini içine değil, işletim sisteminin standart uygulama veri dizinine yönlendirilir: macOS `~/Library/Application Support/academic-research-ide`, Windows `%APPDATA%\academic-research-ide`, Linux `$XDG_DATA_HOME/academic-research-ide` (`~/.local/share/academic-research-ide`). Tüm dosya okumaları/yazmaları ve Python sidecar ortamı (`PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`) UTF-8 zorlar; repo köküne kişisel verileri ve derleme artıklarını dışarıda tutan `.gitignore` eklendi.
- **Gerekçe:** Windows, macOS ve Linux (CachyOS/Hyprland) sistemlerinde taşınabilirlik sağlamak ve GitHub open-source deposunu kişisel veri/sır sızıntısından korumak.

### [2026-11-24] [Faz 2] [ADR-011] Tauri v2 Python FastAPI Sidecar Yaşam Döngüsü ve Dinamik Port Yönetimi
- **Karar:** Tauri v2 Rust çekirdeği uygulama açılışında `127.0.0.1:8765` (meşgul ise dinamik boş port) üzerinde Python FastAPI sidecar sürecini başlatır, `RESEARCH_IDE_DATA_DIR` olarak OS `app_data_dir()` yolunu enjekte eder ve `get_backend_url` Tauri IPC komutuyla arayüze bildirir. Uygulama çıkışında (`RunEvent::ExitRequested`, `RunEvent::Exit` ve `Drop`) arka plan süreci temiz biçimde sonlandırılır.
- **Gerekçe:** Port çakışmalarını önlemek, platformlar arası tutarlı veri yolu sağlamak ve uygulama kapandığında yetim Python/uvicorn süreci bırakmamak.

### [2026-11-24] [Faz 2] [ADR-012] Frontend Durum Mimarisi ve Dayanıklı SSE Takibi
- **Karar:** Sunucu durumu için `@tanstack/react-query`, sekmeler arası paylaşılan istemci seçimleri ve filtreler için genişletilebilir Zustand (`useWorkspaceStore`) kullanılır. `/jobs/{id}/stream` SSE bağlantısı kesilmelere karşı üstel geri çekilmeli yeniden bağlanma + `GET /api/v1/jobs/{id}` yoklama yedeği ile korunur.
- **Gerekçe:** Sekme 2 (Ölçek & Yöntem Matrisi) ile ileride eklenecek Sekme 1 ve Sekme 3 arasında seçili makale/değişken/taslak bağlamını kayıpsız paylaşmak.


### [2026-11-24] [Faz 3] [ADR-013] Sekme 1 Grafik Görselleştirme ve Analitik Motoru
- **Karar:** Sekme 1 görselleştirmesi için `@xyflow/react` ve deterministik yönlendirilmiş yerleşim için `@dagrejs/dagre` seçildi; grafik toplulaştırma, araştırma boşluğu (`gap_score`) ve çelişki kümeleme (`ContradictionCluster`) mantığı `backend/app/services/graph_service.py` servisine taşındı.
- **Gerekçe:** Yönlü akademik ilişki ağlarını büyük grafiklerde dahi akıcı (`React.memo` düğümler + ayrıştırılmış layout memoization) çizebilmek ve literatür boşluğu/çelişki skorlamasını sahte metrik üretmeden yalnızca gerçek veritabanı ilişkileri üzerinden hesaplamak.

### [2026-11-24] [Faz 4] [ADR-014] Sekme 3 Editör ve Hibrit Kanıt/Çelişki Denetim Mimarisi
- **Karar:** Sekme 3 için odaklanılabilir paragraf-indeksli Markdown editörü (`DraftCriticTab`) ve SQLite + LanceDB hibrit çapraz kontrol motoru (`CriticService`, `StyleService`) eklendi. Havuzdaki makalelerde karşılığı bulunmayan iddialar için `related_paper_id = null` ve `page_number = null` tutulur; asla olmayan atıf veya sahte sayfa referansı üretilmez.
- **Gerekçe:** Akademik yazarlıkta kullanıcının kendi stilini (cümle uzunluğu, edilgenlik, hedging/geçiş ifadeleri) korurken yerel makale havuzuyla doğrulanabilir, halüsinasyonsuz kanıt ve çelişki denetimi sağlamak.

### [2026-11-24] [Faz 5] [ADR-015] Çift Dilli (EN/TR) Yerelleştirme ve İngilizce Açık Kaynak Standardı
- **Karar:** Ön yüzde derleme zamanında anahtar eşitliği doğrulanan `src/i18n/` (`en.ts`, `tr.ts`) sözlüğü + `useWorkspaceStore.locale` (`localStorage` + `/api/v1/config` `ui_locale`), arka uçta ise `backend/app/core/i18n.py` (`Accept-Language` başlığı ve açık `locale` parametresi) ile tam `en` / `tr` desteği eklendi. GitHub deposu ana giriş dokümanı (`README.md`) uluslararası açık kaynak standardı olarak İngilizceye çevrildi ve Türkçe eşlikçi olarak `README.tr.md` eklendi.
- **Gerekçe:** Makale metinlerini, alıntıları ve akademik veri yapılarını (`snake_case` JSON sözleşmesi) bozmadan hem uluslararası açık kaynak kullanıcılarına hem Türkçe araştırmacılara tutarlı, halüsinasyonsuz deneyim sunmak.

### [2026-11-24] [Faz 5B] [ADR-016] PyInstaller Standalone Sidecar, Tauri v2 Bundle ve Başlangıç Hazırlık Kapısı
- **Karar:** Python arka ucunu geliştirme `.venv` ortamından bağımsızlaştırmak için `backend/sidecar_main.py`, `backend/sidecar.spec` ve platform hedef üçlüsünü (`rustc -vV`) otomatik algılayan `scripts/build_sidecar.py` oluşturuldu (`PyInstaller --onefile`). `src-tauri/src/lib.rs` geliştirme modunda `.venv` Python veya varsa yerel sidecar'ı, üretim paketinde ise Tauri `externalBin` (`binaries/research-ide-backend`) ikilisini boş yerel portta başlatır; Windows'ta `CREATE_NO_WINDOW` bayrağı, çıkışta ise Unix `SIGTERM`/`SIGKILL` ve Windows `taskkill /PID /T /F` süreç ağacı sonlandırması uygulanır. Ön yüze iki dilli `StartupReadinessGate` eklenerek sidecar `/api/v1/health` hazır olana kadar ilerleme ve hata/tanılama (`get_backend_diagnostics`, `restart_backend`) ekranı sağlanır.
- **Gerekçe:** Son kullanıcının bilgisayarında Python, `uv` veya Rust kurulu olmadan tek tıkla açılan yerel masaüstü uygulaması dağıtabilmek, Windows'ta siyah konsol penceresi ve yetim sidecar süreçlerini önlemek.

### [2026-11-24] [Faz 5B] [ADR-017] `StartupReadinessGate` Efekt İptali Döngüsü Düzeltmesi ve Tauri Üretim Sertleştirmesi
- **Karar:** `src/i18n/index.ts` içindeki `useI18n()` yardımcı fonksiyonları (`t`, `formatNumber`, `formatDate`) `useCallback(..., [locale])` ile memoize edildi; `StartupReadinessGate.tsx` yoklama `useEffect` bağımlılıklarından `t` çıkarıldı, `syncDiagnostics` ile gereksiz state tetiklemeleri engellendi, varsayılan soğuk başlangıç zaman aşımı `45_000` ms'ye yükseltildi ve sidecar `status === "failed"` olduğunda `stderr` günlüklerinin zaman aşımı beklenmeden otomatik açılması sağlandı. Backend `CORSMiddleware` içine `tauri://localhost`, `http(s)://tauri.localhost` ve localhost regex'i eklendi; `BackendState::snapshot()` beklenmedik sidecar çıkışlarını kalıcı `"failed"` durumuna yazar; `sidecar_main.py` içinde deprecated `fitz` yerine `pymupdf` içe aktarılır.
- **Gerekçe:** Üretim `.app` paketinde `getBackendDiagnostics()` çağrısının döndürdüğü yeni nesneyle tetiklenen her render, unmemoize `t` referansını değiştirdiği için `useEffect` temizleme bloğu `/api/v1/health` yanıtı gelmeden önce yoklamayı iptal edip sonsuz döngüye sokuyordu; soğuk başlangıç (`~15s`) ve `tauri://localhost` CORS izniyle birlikte çift tık açılışı kararlı hale getirildi.

### [2026-11-24] [Faz 5B] [ADR-018] Varsayılan Karanlık Mod (Dark-First) & İsteğe Bağlı Aydınlık Mod
- **Karar:** `UiTheme = "dark" | "light"` eklendi; `index.html` açılış anında beyaz flaş oluşmaması için `<html class="dark" data-theme="dark">` + `localStorage` okuyan senkron betik kullanır. `useWorkspaceStore` varsayılan olarak `"dark"` temayla başlar ve `setTheme`/`toggleTheme` aksiyonlarıyla `TopNavBar`, `StartupReadinessGate` ve `SettingsModal` üzerinden anlık olarak Aydınlık/Karanlık geçişi sunar. `src/styles/globals.css` (`html.dark` tasarım tokenları + React Flow karanlık yüzey stilleri) ve `GraphMapTab.tsx` (tema uyumlu arka plan ızgarası ve kenar/boşluk etiketleri) karanlık mod odaklı güncellendi.
- **Gerekçe:** Uzun süreli literatür taraması, kavram grafiği incelemesi ve taslak yazımında göz konforunu artıran karanlık modu standart sunmak, isteyen kullanıcıların da tek tıkla aydınlık moda geçebilmesini sağlamak.

### [2026-11-24] [Faz 6] [ADR-019] Deterministik PyMuPDF Grounding Check ve Split-View PDF Görüntüleyici
- **Karar:** Çıkarılan her `Claim`, `Relationship` ve `Scale` kaydı ingestion sırasında `backend/app/pipeline/grounding.py` ile PyMuPDF sayfa metinlerine karşı deterministik olarak doğrulanır (`grounding_status`: `verified` | `partial` | `unverified`, `grounding_score`, `grounding_note`). Mevcut SQLite veritabanları `SQLiteDatabase.initialize()` içinde idempotent `PRAGMA table_info` sütun göçüyle yükseltilir. Ön yüzde ağır ve Tauri WebView worker kısıtlarına açık harici PDF.js bağımlılığı eklemek yerine backend `GET /api/v1/papers/{id}/page-render` ucu PyMuPDF ile yüksek DPI PNG sayfa görseli ve normalize alıntı vurgulama koordinatları (`PdfHighlightBox`) döner; `PdfReaderPanel` tüm `p. X` tıklamalarında bölünmüş yan panelde o sayfayı açar ve eksik dosya (`PDF_FILE_MISSING`) veya aralık dışı sayfa (`PDF_PAGE_OUT_OF_RANGE`) durumlarını çökmeden iki dilli raporlar.
- **Gerekçe:** LLM halüsinasyonlarını ve yanlış sayfa/alıntı atıflarını uydurma veri üretmeden anında görünür kılmak, ayrıca macOS/Windows/Linux Tauri masaüstü derlemesinde ek tarayıcı worker yapılandırması gerektirmeden kesin piksel/metin vurgulu PDF okuma deneyimi sunmak.
