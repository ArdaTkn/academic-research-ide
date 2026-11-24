# Academic Research IDE

**English** | [Türkçe](README.tr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Desktop-Tauri%20v2-24C8DB.svg)](https://v2.tauri.app/)
[![React 19 + TypeScript](https://img.shields.io/badge/Frontend-React%2019%20%2B%20TS-61DAFB.svg)](https://react.dev/)
[![FastAPI + Python 3.12](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python%203.12-009688.svg)](https://fastapi.tiangolo.com/)
[![i18n: EN / TR](https://img.shields.io/badge/i18n-EN%20%7C%20TR-blueviolet.svg)](src/i18n/)

A local-first desktop workspace built on **Tauri v2 + React/TypeScript + Python (FastAPI / SQLite / LanceDB)** for structured academic literature ingestion, psychometric scale & method comparison, concept/gap/contradiction mapping, and style-aware draft auditing.

---

## Core Modules & Capabilities

All tabs share a single local **SQLite (WAL + FTS5)** + **LanceDB** knowledge base inside the OS application data directory, surfaced through a clean 3-tab IDE with a collapsible PDF Paper Pool sidebar:

1. **PDF Ingestion & Vector Indexing Pipeline (`backend/app/pipeline/`)**
   - Page-preserving extraction using `PyMuPDF` (primary) and `pdfplumber` (table/fallback).
   - OpenAI-compatible structured extraction (`PaperExtractionPayload`): independent/dependent/mediator/moderator/control variables, directed empirical relationships (`+`, `-`, insignificant, mixed, curvilinear), psychometric scales (Cronbach's α, CR, AVE, item count, response format), sample profile, and page-referenced claims.
   - **Fail-closed validation:** Scanned/empty PDFs or schema/page-bounds violations are never silently swallowed into SQLite; progress and structured `ApiError` diagnostics stream live over SSE (`/api/v1/jobs/{job_id}/stream`).

2. **Tab 1 — Concept, Gap & Contradiction Map (`src/features/graph-map/`)**
   - Interactive directed variable network rendered with `@xyflow/react` and `@dagrejs/dagre`.
   - **Research Gap Discovery:** Highlights unstudied or under-studied variable pairs sharing common network neighbors with computed gap scores.
   - **Contradiction Comparison Panel:** Displays opposing empirical studies side-by-side with effect direction, effect size, `p`-value, sample size (`N`), statistical method, page number, and verbatim quote snippets.
   - **Canonical Variable Merging:** Merge synonymous constructs into a canonical variable and immediately recompute graph edges and contradiction clusters.

3. **Tab 2 — Scale & Method Matrix (`src/features/scale-matrix/`)**
   - Sortable, multi-filter matrix (`@tanstack/react-table`) across scale name, variable, Cronbach's α threshold, item count, sample size, statistical method, and publication year.
   - Direct jump to the `PaperDetailDrawer` plus localized **CSV / JSON** export matching active filters.

4. **Tab 3 — Draft Editor, Style Profile & Evidence/Contradiction Critic (`src/features/draft-critic/`)**
   - **Style Profile Extractor:** Analyzes your past `.md`, `.txt`, or `.pdf` writing to capture average sentence pacing, passive voice ratio, hedging/transition markers, and citation style, indexing style exemplars in LanceDB (`style_chunks`).
   - **Evidence & Contradiction Critic:** Cross-checks each Markdown paragraph against your local SQLite + LanceDB pool for contradicting evidence, missing citations, supporting findings, and style deviations—**never fabricating citations or page numbers** when a claim has no pool match.

5. **Full Bilingual Localization (`EN` / `TR`)**
   - Instant live switching between **English** (`en`, default) and **Turkish** (`tr`) via the `EN / TR` toggle in the top bar or Settings modal.
   - Persists across `localStorage` and backend `config.json` (`ui_locale`), localizing UI copy, backend audit/style/gap/error messages, number formatting, and CSV export headers without translating original PDF quotes or paper titles.

---

## Cross-Platform Support & Local Privacy

- **Supported Operating Systems:** **Windows**, **macOS**, and **Linux** (including CachyOS / Hyprland).
- **Offline-First LLM Integration:** Preconfigured for local **Ollama** (`http://127.0.0.1:11434/v1`) or **LM Studio**, with optional OpenAI-compatible remote endpoints in Settings.
- **OS-Standard Data Storage:** User PDFs, `research.db` (SQLite), LanceDB tables, and `config.json` are stored outside the repository in the platform data directory (override via `RESEARCH_IDE_DATA_DIR`):

| Operating System | Default Application Data Directory |
|---|---|
| **macOS** | `~/Library/Application Support/academic-research-ide/` |
| **Windows** | `%APPDATA%\academic-research-ide\` |
| **Linux** | `$XDG_DATA_HOME/academic-research-ide/` (or `~/.local/share/academic-research-ide/`) |

The Tauri v2 host (`src-tauri/src/lib.rs`) spawns the local FastAPI sidecar on a free localhost port with `PYTHONUTF8=1` and gracefully shuts it down on window exit.

---

## Getting Started

### Prerequisites
- **Python 3.12** and **[uv](https://docs.astral.sh/uv/)**
- **Node.js 20+** and **npm**
- **Rust & Cargo** (for Tauri v2 desktop builds; on Linux, install standard Tauri v2 dependencies such as `webkit2gtk-4.1` and `libayatana-appindicator`)
- *(Optional, for live LLM extraction)* Local **Ollama** or **LM Studio** server

### 1. Clone the Repository
```bash
git clone https://github.com/ArdaTkn/academic-research-ide.git
cd academic-research-ide
```

### 2. Set Up the Python 3.12 Backend (`uv`)
```bash
cd backend
uv python pin 3.12
uv venv --python 3.12
uv sync --dev
cd ..
```

### 3. Install Frontend Dependencies
```bash
npm install
```

### 4. Configure Environment *(Optional)*
```bash
cp .env.example .env
```
Defaults point to local Ollama (`http://127.0.0.1:11434/v1`, `qwen2.5:14b`) and English UI (`RESEARCH_IDE_UI_LOCALE=en`), all editable in the **Model & Interface Settings** modal.

### 5. Run the Application

**Option A — Full Desktop App (Tauri v2 + Managed Python Sidecar):**
```bash
npm run tauri dev
```

**Option B — Separate Backend + Browser Dev Server:**
```bash
# Terminal 1 (Backend)
cd backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload

# Terminal 2 (Frontend)
npm run dev
```

---

## Testing & Verification

```bash
# Backend suite (SQLite, LanceDB, PDF/LLM fail-closed guards, Graph, Draft Critic, i18n, E2E)
cd backend && .venv/bin/pytest -v

# Frontend typecheck, Vitest unit/component tests, and production bundle
npm run typecheck
npm run test
npm run build

# Tauri Rust host check
cd src-tauri && cargo check
```

---

## Project Structure

```text
academic-research-ide/
├── .agent_state/               # Source-of-truth schema, roadmap, and architecture decision log
│   ├── SCHEMA_AND_CONTRACTS.md
│   ├── ROADMAP_AND_STATUS.md
│   └── DECISION_LOG.md
├── backend/
│   ├── app/
│   │   ├── api/                # FastAPI /api/v1 routers
│   │   ├── core/               # Cross-platform settings, i18n catalog, and ApiError envelopes
│   │   ├── db/                 # SQLite (WAL/FTS5) & LanceDB vector store
│   │   ├── models/             # Pydantic v2 contract schemas
│   │   ├── pipeline/           # PDF extractor, LLM JSON extractor, normalizer & SSE worker
│   │   └── services/           # GraphService, StyleService, CriticService
│   ├── tests/                  # Pytest unit & E2E tests
│   └── pyproject.toml
├── src/
│   ├── api/                    # Typed Fetch client + resilient SSE stream subscriber
│   ├── components/             # TopNavBar, SettingsModal, PaperDetailDrawer
│   ├── features/
│   │   ├── ingestion/          # PDF upload & live SSE paper pool sidebar
│   │   ├── graph-map/          # Tab 1: React Flow + Dagre + Contradiction Comparison
│   │   ├── scale-matrix/       # Tab 2: TanStack Table Scale & Method Matrix
│   │   └── draft-critic/       # Tab 3: Markdown editor, style profile & evidence critic
│   ├── i18n/                   # Type-safe EN / TR dictionaries and formatting helpers
│   ├── stores/                 # Cross-tab Zustand workspace store
│   └── types/                  # TypeScript types aligned 1:1 with SCHEMA_AND_CONTRACTS.md
├── src-tauri/                  # Tauri v2 Rust sidecar launcher & clean shutdown handler
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── README.tr.md
└── package.json
```

---

## Architecture & Development Protocol (`.agent_state/`)

This repository follows a multi-agent, contract-first engineering workflow. SQLite DDL tables, LanceDB collections, Pydantic v2 schemas, `/api/v1` endpoints, and TypeScript interfaces are anchored in [`.agent_state/SCHEMA_AND_CONTRACTS.md`](.agent_state/SCHEMA_AND_CONTRACTS.md), with architectural choices tracked in [`.agent_state/DECISION_LOG.md`](.agent_state/DECISION_LOG.md).

---

## License

Released under the [MIT License](LICENSE).
