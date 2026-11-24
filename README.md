# Academic Research IDE

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Desktop-Tauri%20v2-24C8DB.svg)](https://v2.tauri.app/)
[![React 19 + TypeScript](https://img.shields.io/badge/Frontend-React%2019%20%2B%20TS-61DAFB.svg)](https://react.dev/)
[![FastAPI + Python 3.12](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python%203.12-009688.svg)](https://fastapi.tiangolo.com/)

Yerel çalışan (local-first), **Tauri v2 + React/TypeScript + Python (FastAPI / SQLite / LanceDB)** tabanlı akademik literatür tarama, ölçek/yöntem kıyaslama, kavram-çelişki haritalama ve kaynak doğrulamalı yazım ortamı.

---

## Temel Özellikler ve Modüller

Uygulama, arka planda ortak **SQLite (WAL + FTS5)** ve **LanceDB** vektör veritabanından beslenen, ön yüzde ise birbirine bağlı 3 ana çalışma sekmesinden oluşur:

1. **Arka Plan PDF Ayrıştırma & Vektör İndeksleme Hattı (`backend/app/pipeline/`)**
   - `PyMuPDF` (birincil) + `pdfplumber` (tablo/yedek) ile sayfa numarası korumalı PDF metin çıkarımı.
   - OpenAI uyumlu yapılandırılmış JSON çıkarımı (`PaperExtractionPayload`): bağımlı/bağımsız/aracı/düzenleyici değişkenler, yönlü ilişkiler (`+`, `-`, anlamsız, karışık, eğrisel), psikometrik ölçekler (Cronbach's α, CR, AVE, madde sayısı), örneklem profili ve sayfa referanslı iddialar.
   - **Fail-closed doğrulama:** Bozuk/taranmış PDF veya şema/sayfa sınırı ihlali olan çıktılar veritabanına yazılmaz; `IngestionJob` ve SSE (`/api/v1/jobs/{job_id}/stream`) üzerinden şeffaf biçimde raporlanır.

2. **Sekme 1 — Kavram, Boşluk & Çelişki Haritası (`src/features/graph-map/`)**
   - `@xyflow/react` ve `@dagrejs/dagre` ile etkileşimli, yönlü kavram grafiği.
   - **Araştırma Boşluğu (Research Gap):** Doğrudan çalışılmamış veya az çalışılmış ortak komşulu değişken çiftlerini kesikli kenarlar ve boşluk skoruyla vurgular.
   - **Çelişki Kıyaslama Paneli:** Aynı ilişki için zıt sonuçlar bulan makaleleri etki yönü, etki büyüklüğü, `p` değeri, örneklem büyüklüğü (`N`), istatistiksel yöntem ve sayfa referansıyla yan yana kıyaslar.
   - **Kanonik Değişken Birleştirme:** Eş anlamlı kavramları tek düğümde birleştirerek graf ve çelişki kümelerini anlık günceller.

3. **Sekme 2 — Ölçek & Yöntem Matrisi (`src/features/scale-matrix/`)**
   - `@tanstack/react-table` tabanlı çoklu filtreli ve sıralanabilir matris: ölçek adı, değişken, Cronbach α aralığı, madde sayısı, örneklem büyüklüğü, istatistiksel yöntem ve yayın yılı filtreleri.
   - Satır detay çekmecesi ve etkin filtrelerle birebir uyumlu **CSV / JSON** dışa aktarım.

4. **Sekme 3 — Taslak Editörü, Stil Profili & Kanıt/Çelişki Denetçisi (`src/features/draft-critic/`)**
   - **Stil Profili Çıkarıcı:** Kullanıcının geçmiş `.md`, `.txt` veya `.pdf` akademik metinlerinden ortalama cümle uzunluğu, edilgenlik oranı, hedging/geçiş ifadeleri ve atıf biçimini çıkarır; örnekleri LanceDB `style_chunks` içine indeksler.
   - **Kanıt & Çelişki Denetçisi:** Yazılan her paragrafı yerel makale havuzu (SQLite + LanceDB) ile çapraz kontrol eder; çelişkileri, eksik atıfları ve destekleyici kanıtları **sayfa referansı ve alıntı** ile gösterir. Havuzda karşılığı olmayan iddialar için asla uydurma kaynak veya sahte sayfa numarası üretmez.

---

## Çoklu Platform Desteği ve Yerel Gizlilik

- **Desteklenen Platformlar:** **Windows**, **macOS** ve **Linux** (CachyOS / Hyprland dahil).
- **Yerel Çalışma (Offline-First):** Varsayılan olarak yerel **Ollama** / **LM Studio** uç noktalarına bağlanacak şekilde yapılandırılmıştır; istenirse ayarlardan OpenAI uyumlu harici bir API anahtarı da tanımlanabilir.
- **Standart Kullanıcı Veri Dizini:** Kişisel makale PDF'leri, SQLite veritabanı (`research.db`), LanceDB vektörleri ve `config.json` proje deposu içinde değil, işletim sisteminin standart uygulama veri dizininde saklanır (`RESEARCH_IDE_DATA_DIR` ile geçersiz kılınabilir):

| İşletim Sistemi | Varsayılan Kullanıcı Veri Dizini |
|---|---|
| **macOS** | `~/Library/Application Support/academic-research-ide/` |
| **Windows** | `%APPDATA%\academic-research-ide\` |
| **Linux** | `$XDG_DATA_HOME/academic-research-ide/` (veya `~/.local/share/academic-research-ide/`) |

Tauri v2 kabuğu (`src-tauri/src/lib.rs`), uygulama açılışında boş bir yerel port seçip FastAPI sidecar sürecini UTF-8 zorlamasıyla (`PYTHONUTF8=1`) başlatır ve uygulama kapatıldığında arka plan sürecini temiz biçimde sonlandırır.

---

## Kurulum ve Çalıştırma

### Önkoşullar
- **Python 3.12** ve **[uv](https://docs.astral.sh/uv/)**
- **Node.js 20+** ve **npm**
- **Rust & Cargo** (Tauri v2 masaüstü derlemesi için — Linux'ta ek olarak Tauri v2 sistem paketleri `webkit2gtk-4.1`, `libayatana-appindicator` vb. gerekir)
- *(Opsiyonel, canlı LLM çıkarımı için)* Yerel **Ollama** veya **LM Studio** sunucusu

### 1. Depoyu Klonlayın
```bash
git clone <repo-url>
cd academic-research-ide
```

### 2. Backend Ortamını Kurun (Python 3.12 + `uv`)
```bash
cd backend
uv python pin 3.12
uv venv --python 3.12
uv sync --dev
cd ..
```

### 3. Frontend Bağımlılıklarını Kurun
```bash
npm install
```

### 4. Ortam Değişkenlerini Hazırlayın *(Opsiyonel)*
```bash
cp .env.example .env
```
Varsayılan ayarlar `http://127.0.0.1:11434/v1` (Ollama) ve `qwen2.5:14b` ile çalışacak şekilde yapılandırılmıştır. Uygulama içindeki **Model Ayarları** penceresinden de güncellenebilir.

### 5. Uygulamayı Çalıştırın

**Seçenek A — Tam Masaüstü Uygulaması (Tauri v2 + Otomatik Python Sidecar):**
```bash
npm run tauri dev
```

**Seçenek B — Ayrı Backend + Tarayıcı Geliştirme Modu:**
```bash
# Terminal 1 (Backend)
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

# Terminal 2 (Frontend)
npm run dev
```

---

## Test ve Doğrulama Komutları

```bash
# Backend testleri (SQLite, LanceDB, PDF/LLM dayanıklılık, Grafik, Taslak Denetçisi, E2E)
cd backend && .venv/bin/pytest -v

# Frontend tip kontrolü, Vitest testleri ve üretim derlemesi
npm run typecheck
npm run test
npm run build

# Tauri Rust çekirdeği derleme kontrolü
cd src-tauri && cargo check
```

---

## Proje Dizin Yapısı

```text
academic-research-ide/
├── .agent_state/               # Tek hakikat kaynağı şema, yol haritası ve mimari karar kayıtları
│   ├── SCHEMA_AND_CONTRACTS.md
│   ├── ROADMAP_AND_STATUS.md
│   └── DECISION_LOG.md
├── backend/
│   ├── app/
│   │   ├── api/                # FastAPI /api/v1 yönlendiricileri
│   │   ├── core/               # Çoklu platform yapılandırma & ApiError hata zarfı
│   │   ├── db/                 # SQLite (WAL/FTS5) & LanceDB vektör deposu
│   │   ├── models/             # Pydantic v2 sözleşme modelleri
│   │   ├── pipeline/           # PDF çıkarıcı, LLM JSON çıkarıcı, normalizer & SSE worker
│   │   └── services/           # GraphService, StyleService, CriticService
│   ├── tests/                  # Pytest birim ve E2E testleri
│   └── pyproject.toml
├── src/
│   ├── api/                    # Typed Fetch + dayanıklı SSE istemcisi
│   ├── components/             # Üst çubuk, Ayarlar modalı, Makale Detay çekmecesi
│   ├── features/
│   │   ├── ingestion/          # PDF yükleme ve canlı SSE havuz kenar çubuğu
│   │   ├── graph-map/          # Sekme 1: React Flow + Dagre + Çelişki kıyaslama
│   │   ├── scale-matrix/       # Sekme 2: TanStack Table Ölçek & Yöntem Matrisi
│   │   └── draft-critic/       # Sekme 3: Markdown editör, stil profili & kanıt denetçisi
│   ├── stores/                 # Sekmeler arası paylaşımlı Zustand durumu
│   └── types/                  # SCHEMA_AND_CONTRACTS.md ile birebir TypeScript tipleri
├── src-tauri/                  # Tauri v2 Rust sidecar başlatıcısı ve temiz kapanma yönetimi
├── .env.example
├── .gitignore
├── LICENSE
└── package.json
```

---

## Mimari ve Geliştirme Notu (`.agent_state/`)

Bu proje çoklu-ajan / model-bağımsız geliştirme protokolüyle geliştirilmiştir. Tüm SQLite DDL şemaları, LanceDB vektör tabloları, Pydantic v2 modelleri, FastAPI `/api/v1` uçları ve TypeScript tipleri [`.agent_state/SCHEMA_AND_CONTRACTS.md`](.agent_state/SCHEMA_AND_CONTRACTS.md) içinde tek hakikat kaynağı olarak tutulur; mimari kararlar ise [`.agent_state/DECISION_LOG.md`](.agent_state/DECISION_LOG.md) dosyasında belgelenmiştir.

---

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında açık kaynak olarak sunulmaktadır.
