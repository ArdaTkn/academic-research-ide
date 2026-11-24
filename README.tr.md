# Academic Research IDE

[English](README.md) | **Türkçe**

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Desktop-Tauri%20v2-24C8DB.svg)](https://v2.tauri.app/)
[![React 19 + TypeScript](https://img.shields.io/badge/Frontend-React%2019%20%2B%20TS-61DAFB.svg)](https://react.dev/)
[![FastAPI + Python 3.12](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python%203.12-009688.svg)](https://fastapi.tiangolo.com/)
[![i18n: EN / TR](https://img.shields.io/badge/i18n-EN%20%7C%20TR-blueviolet.svg)](src/i18n/)

Yerel çalışan (local-first), **Tauri v2 + React/TypeScript + Python (FastAPI / SQLite / LanceDB)** tabanlı akademik literatür tarama, ölçek/yöntem kıyaslama, kavram-boşluk-çelişki haritalama ve stil/kaynak doğrulamalı yazım ortamı.

---

## Temel Özellikler ve Modüller

Uygulama, arka planda ortak **SQLite (WAL + FTS5)** ve **LanceDB** vektör veritabanından beslenen, ön yüzde ise birbirine bağlı 3 ana çalışma sekmesinden oluşur:

1. **Arka Plan PDF Ayrıştırma & Vektör İndeksleme Hattı (`backend/app/pipeline/`)**
   - `PyMuPDF` (birincil) ve `pdfplumber` (tablo/yedek) ile sayfa numarası korumalı PDF metin çıkarımı.
   - OpenAI uyumlu yapılandırılmış JSON çıkarımı (`PaperExtractionPayload`): bağımlı/bağımsız/aracı/düzenleyici/kontrol değişkenleri, yönlü ilişkiler (`+`, `-`, anlamsız, karışık, eğrisel), psikometrik ölçekler (Cronbach's α, CR, AVE, madde sayısı, yanıt formatı), örneklem profili ve sayfa referanslı iddialar.
   - **Fail-closed doğrulama:** Bozuk/taranmış PDF veya şema/sayfa sınırı ihlali olan çıktılar veritabanına yazılmaz; `IngestionJob` ve SSE (`/api/v1/jobs/{job_id}/stream`) üzerinden şeffaf biçimde raporlanır.

2. **Sekme 1 — Kavram, Boşluk & Çelişki Haritası (`src/features/graph-map/`)**
   - `@xyflow/react` ve `@dagrejs/dagre` ile etkileşimli, yönlü kavram grafiği.
   - **Araştırma Boşluğu (Research Gap):** Doğrudan çalışılmamış veya az çalışılmış ortak komşulu değişken çiftlerini kesikli kenarlar ve boşluk skoruyla vurgular.
   - **Çelişki Kıyaslama Paneli:** Aynı ilişki için zıt sonuçlar bulan makaleleri etki yönü, etki büyüklüğü, `p` değeri, örneklem büyüklüğü (`N`), istatistiksel yöntem, sayfa referansı ve özgün alıntıyla yan yana kıyaslar.
   - **Kanonik Değişken Birleştirme:** Eş anlamlı kavramları tek düğümde birleştirerek graf ve çelişki kümelerini anlık günceller.

3. **Sekme 2 — Ölçek & Yöntem Matrisi (`src/features/scale-matrix/`)**
   - `@tanstack/react-table` tabanlı çoklu filtreli ve sıralanabilir matris: ölçek adı, değişken, Cronbach α aralığı, madde sayısı, örneklem büyüklüğü, istatistiksel yöntem ve yayın yılı filtreleri.
   - Satır detay çekmecesi (`PaperDetailDrawer`) ve etkin filtrelerle uyumlu yerelleştirilmiş **CSV / JSON** dışa aktarım.

4. **Sekme 3 — Taslak Editörü, Stil Profili & Kanıt/Çelişki Denetçisi (`src/features/draft-critic/`)**
   - **Stil Profili Çıkarıcı:** Kullanıcının geçmiş `.md`, `.txt` veya `.pdf` akademik metinlerinden ortalama cümle uzunluğu, edilgenlik oranı, hedging/geçiş ifadeleri ve atıf biçimini çıkarır; örnekleri LanceDB `style_chunks` içine indeksler.
   - **Kanıt & Çelişki Denetçisi:** Yazılan her paragrafı yerel makale havuzu (SQLite + LanceDB) ile çapraz kontrol eder; çelişkileri, eksik atıfları ve destekleyici kanıtları **sayfa referansı ve özgün alıntı** ile gösterir. Havuzda karşılığı olmayan iddialar için asla uydurma kaynak veya sahte sayfa numarası üretmez.

5. **Tam Çift Dilli Destek (`EN` / `TR`)**
   - Üst çubuktaki `EN / TR` düğmesi veya Ayarlar penceresinden sayfa yenilemeden **İngilizce** (`en`, varsayılan) ve **Türkçe** (`tr`) arasında anlık geçiş yapılır.
   - Dil tercihi `localStorage` ve backend `config.json` (`ui_locale`) üzerinde senkronize edilir; arayüz etiketleri, hata/denetim/stil mesajları, sayı biçimleri ve CSV başlıkları seçili dile uyarlanırken PDF'lerden çıkarılan orijinal makale başlıkları ve alıntılar (`quote_snippet`) değiştirilmez.

---

## Çoklu Platform Desteği ve Yerel Gizlilik

- **Desteklenen Platformlar:** **Windows**, **macOS** ve **Linux** (CachyOS / Hyprland dahil).
- **Yerel Çalışma (Offline-First):** Varsayılan olarak yerel **Ollama** (`http://127.0.0.1:11434/v1`) veya **LM Studio** uç noktalarına bağlanır; istenirse ayarlardan OpenAI uyumlu harici bir API anahtarı da tanımlanabilir.
- **Standart Kullanıcı Veri Dizini:** Kişisel makale PDF'leri, `research.db` (SQLite), LanceDB vektörleri ve `config.json` proje deposu içinde değil, işletim sisteminin standart uygulama veri dizininde saklanır (`RESEARCH_IDE_DATA_DIR` ile geçersiz kılınabilir):

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
- **Rust & Cargo** (Tauri v2 masaüstü derlemesi için — Linux'ta ek olarak `webkit2gtk-4.1`, `libayatana-appindicator` gibi sistem paketleri gerekir)
- *(Opsiyonel, canlı LLM çıkarımı için)* Yerel **Ollama** veya **LM Studio** sunucusu

### 1. Depoyu Klonlayın
```bash
git clone https://github.com/ArdaTkn/academic-research-ide.git
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
Varsayılan ayarlar `http://127.0.0.1:11434/v1` (Ollama), `qwen2.5:14b` ve `RESEARCH_IDE_UI_LOCALE=en` olarak yapılandırılmıştır; uygulama içindeki **Model ve Arayüz Ayarları** penceresinden de güncellenebilir.

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
# Backend testleri (SQLite, LanceDB, PDF/LLM dayanıklılık, Grafik, Taslak Denetçisi, i18n, E2E)
cd backend && .venv/bin/pytest -v

# Frontend tip kontrolü, Vitest testleri ve üretim derlemesi
npm run typecheck
npm run test
npm run build

# Tauri Rust çekirdeği derleme kontrolü
cd src-tauri && cargo check
```

---

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında açık kaynak olarak sunulmaktadır.
