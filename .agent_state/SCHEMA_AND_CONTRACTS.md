# SCHEMA_AND_CONTRACTS.md — Tek Hakikat Kaynağı (Single Source of Truth)

> **Proje:** Academic Research IDE (Tauri v2 + React/TypeScript + Python FastAPI + SQLite/LanceDB)  
> **Son Güncelleme:** 2026-11-24 | **Faz:** Faz 0 (İskelet ve Sözleşme) | **Sorumlu:** `[Agent-Architect]`  
> **Kural:** Tüm ajanlar ve LLM oturumları veritabanı, Pydantic v2, FastAPI HTTP/SSE ve TypeScript tiplerini yalnızca bu dosyadaki tanımlara birebir sadık kalarak üretir. Şema değişikliği gerektiğinde önce bu dosya güncellenir, ardından `DECISION_LOG.md` içine kayıt düşülür.

---

## 1. Genel Kontrat Kuralları (Global Conventions)

1. **Kimlikler (IDs):** Tüm birincil ve yabancı anahtarlar UUIDv4 dizesidir (`TEXT PRIMARY KEY` / `str` / `string`).
2. **Zaman Damgaları (Timestamps):** ISO-8601 UTC formatında dize (`YYYY-MM-DDTHH:MM:SSZ`, örn. `2026-11-24T18:00:00Z`).
3. **Alan Adlandırma (Naming):** SQLite sütunları, Pydantic v2 modelleri, FastAPI JSON yükleri ve TypeScript arayüzleri dahil **tüm katmanlarda istisnasız `snake_case`** kullanılır. (Farklı LLM oturumları ve ajanlar arasında `camelCase` ↔ `snake_case` dönüşüm hatalarını sıfırlamak için zorunludur.)
4. **JSON Alanları:** SQLite'ta `*_json` sütunları doğrulanmış JSON string olarak saklanır; Pydantic ve TypeScript katmanlarında doğrudan tiplenmiş dizi/nesne (`list[...]`, `T[]`) olarak sunulur.
5. **SQLite Bağlantı Pragmaları:** Her bağlantı açılışında zorunlu olarak çalıştırılır:
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA busy_timeout = 5000;`
6. **API Temel Adresi:** `http://127.0.0.1:8765/api/v1` (Tauri sidecar başlatıcısı farklı port enjekte edebilir; istemci runtime yapılandırmasından okur).
7. **Sayfa Referansları:** Makaleden çıkarılan her iddia (`Claim`), ilişki (`Relationship`), değişken eşleşmesi (`PaperVariable`), ölçek (`Scale`) ve denetim bulgusu (`AuditFinding`) için `page_number` 1-tabanlı tamsayıdır (`>= 1`).

---

## 2. Bölüm A — SQLite DDL Şeması (`schema.sql` Referansı)

Aşağıdaki SQL bloğu doğrudan `sqlite3` üzerinde çalıştırılabilir tek geçerli DDL referansıdır.

```sql
PRAGMA foreign_keys = ON;

-- 1. Makaleler (Papers)
CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER CHECK (year IS NULL OR (year >= 1800 AND year <= 2100)),
    journal TEXT,
    doi TEXT,
    abstract TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    file_path TEXT NOT NULL,
    file_hash_sha256 TEXT NOT NULL UNIQUE,
    page_count INTEGER NOT NULL CHECK (page_count >= 1),
    sample_size INTEGER CHECK (sample_size IS NULL OR sample_size >= 0),
    sample_population TEXT,
    sampling_method TEXT,
    study_context TEXT,
    statistical_methods_json TEXT NOT NULL DEFAULT '[]',
    research_design TEXT,
    ingestion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (ingestion_status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
    ingestion_error TEXT,
    raw_extraction_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Sayfa Referanslı Ana İddialar (Claims)
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    claim_text TEXT NOT NULL,
    claim_type TEXT NOT NULL
        CHECK (claim_type IN ('main_finding', 'hypothesis', 'limitation', 'theoretical', 'methodological')),
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    section_name TEXT,
    quote_snippet TEXT,
    confidence_score REAL NOT NULL DEFAULT 0.8 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    created_at TEXT NOT NULL
);

-- 3. Kanonik Değişkenler / Kavramlar (Variables)
CREATE TABLE IF NOT EXISTS variables (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL UNIQUE,
    normalized_key TEXT NOT NULL UNIQUE,
    display_label TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    definition TEXT,
    domain_tag TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Makale-Değişken Rol Eşleşmeleri (Paper Variables)
CREATE TABLE IF NOT EXISTS paper_variables (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    variable_id TEXT NOT NULL REFERENCES variables(id) ON DELETE CASCADE,
    role TEXT NOT NULL
        CHECK (role IN ('independent', 'dependent', 'mediator', 'moderator', 'control', 'outcome')),
    local_name TEXT NOT NULL,
    page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
    UNIQUE (paper_id, variable_id, role)
);

-- 5. Değişkenler Arası İlişkiler (Relationships)
CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    source_variable_id TEXT NOT NULL REFERENCES variables(id) ON DELETE CASCADE,
    target_variable_id TEXT NOT NULL REFERENCES variables(id) ON DELETE CASCADE,
    source_role TEXT
        CHECK (source_role IS NULL OR source_role IN ('independent', 'dependent', 'mediator', 'moderator', 'control', 'outcome')),
    target_role TEXT
        CHECK (target_role IS NULL OR target_role IN ('independent', 'dependent', 'mediator', 'moderator', 'control', 'outcome')),
    direction TEXT NOT NULL
        CHECK (direction IN ('positive', 'negative', 'insignificant', 'mixed', 'curvilinear')),
    effect_size REAL,
    effect_metric TEXT,
    p_value TEXT,
    statistical_method TEXT,
    mediator_variable_id TEXT REFERENCES variables(id) ON DELETE SET NULL,
    moderator_variable_id TEXT REFERENCES variables(id) ON DELETE SET NULL,
    sample_subgroup TEXT,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    quote_snippet TEXT,
    confidence_score REAL NOT NULL DEFAULT 0.8 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    created_at TEXT NOT NULL
);

-- 6. Ölçekler ve Psikometrik Özellikler (Scales)
CREATE TABLE IF NOT EXISTS scales (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    variable_id TEXT REFERENCES variables(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    original_authors TEXT,
    original_year INTEGER CHECK (original_year IS NULL OR (original_year >= 1800 AND original_year <= 2100)),
    item_count INTEGER CHECK (item_count IS NULL OR item_count > 0),
    cronbach_alpha REAL CHECK (cronbach_alpha IS NULL OR (cronbach_alpha >= 0.0 AND cronbach_alpha <= 1.0)),
    composite_reliability REAL CHECK (composite_reliability IS NULL OR (composite_reliability >= 0.0 AND composite_reliability <= 1.0)),
    ave REAL CHECK (ave IS NULL OR (ave >= 0.0 AND ave <= 1.0)),
    response_format TEXT,
    language TEXT,
    sample_size_override INTEGER CHECK (sample_size_override IS NULL OR sample_size_override >= 0),
    adaptation_notes TEXT,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    created_at TEXT NOT NULL
);

-- 7. Kullanıcı Akademik Stil Profilleri (Style Profiles)
CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_files_json TEXT NOT NULL DEFAULT '[]',
    tone TEXT NOT NULL,
    avg_sentence_length REAL NOT NULL CHECK (avg_sentence_length >= 0.0),
    passive_voice_ratio REAL NOT NULL CHECK (passive_voice_ratio >= 0.0 AND passive_voice_ratio <= 1.0),
    hedging_phrases_json TEXT NOT NULL DEFAULT '[]',
    transition_phrases_json TEXT NOT NULL DEFAULT '[]',
    citation_style TEXT NOT NULL DEFAULT 'APA 7',
    lexical_preferences_json TEXT NOT NULL DEFAULT '{}',
    system_prompt_summary TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 8. Markdown Taslaklar (Drafts)
CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content_markdown TEXT NOT NULL DEFAULT '',
    style_profile_id TEXT REFERENCES style_profiles(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 9. Paragraf Bazlı Taslak Denetim Sonuçları (Audit Results)
CREATE TABLE IF NOT EXISTS audit_results (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    paragraph_index INTEGER NOT NULL CHECK (paragraph_index >= 0),
    paragraph_hash TEXT NOT NULL,
    paragraph_text TEXT NOT NULL,
    overall_status TEXT NOT NULL
        CHECK (overall_status IN ('supported', 'warning', 'contradicted', 'unsupported')),
    style_alignment_score REAL NOT NULL CHECK (style_alignment_score >= 0.0 AND style_alignment_score <= 1.0),
    evidence_coverage_score REAL NOT NULL CHECK (evidence_coverage_score >= 0.0 AND evidence_coverage_score <= 1.0),
    summary TEXT NOT NULL,
    model_used TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 10. Denetim Bulguları (Audit Findings)
CREATE TABLE IF NOT EXISTS audit_findings (
    id TEXT PRIMARY KEY,
    audit_result_id TEXT NOT NULL REFERENCES audit_results(id) ON DELETE CASCADE,
    finding_type TEXT NOT NULL
        CHECK (finding_type IN ('unsupported_claim', 'contradiction', 'supporting_evidence', 'style_deviation', 'missing_citation')),
    severity TEXT NOT NULL
        CHECK (severity IN ('info', 'warning', 'error')),
    excerpt TEXT NOT NULL,
    explanation TEXT NOT NULL,
    suggestion TEXT,
    related_paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
    related_claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
    related_relationship_id TEXT REFERENCES relationships(id) ON DELETE SET NULL,
    page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
    quote_snippet TEXT,
    is_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (is_dismissed IN (0, 1)),
    created_at TEXT NOT NULL
);

-- 11. Arka Plan İşlem Kuyruğu (Ingestion Jobs)
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id TEXT PRIMARY KEY,
    paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'extracting_text', 'parsing_llm', 'indexing_vectors', 'completed', 'failed')),
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    current_stage_message TEXT,
    error_detail TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
);

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_claims_paper ON claims(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_variables_paper ON paper_variables(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_variables_var ON paper_variables(variable_id);
CREATE INDEX IF NOT EXISTS idx_relationships_pair ON relationships(source_variable_id, target_variable_id);
CREATE INDEX IF NOT EXISTS idx_relationships_paper ON relationships(paper_id);
CREATE INDEX IF NOT EXISTS idx_scales_paper ON scales(paper_id);
CREATE INDEX IF NOT EXISTS idx_scales_variable ON scales(variable_id);
CREATE INDEX IF NOT EXISTS idx_scales_alpha ON scales(cronbach_alpha);
CREATE INDEX IF NOT EXISTS idx_audit_results_draft_hash ON audit_results(draft_id, paragraph_hash);
CREATE INDEX IF NOT EXISTS idx_audit_findings_result ON audit_findings(audit_result_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status);

-- Tam Metin Arama (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    paper_id UNINDEXED,
    title,
    abstract,
    sample_population,
    study_context
);

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
    claim_id UNINDEXED,
    paper_id UNINDEXED,
    claim_text,
    quote_snippet
);
```

---

## 3. Bölüm B — LanceDB Vektör Tablo Şemaları

LanceDB yerel dizini: `$RESEARCH_IDE_DATA_DIR/lancedb/` (varsayılan işletim sistemi uygulama veri dizini: macOS `~/Library/Application Support/academic-research-ide/lancedb/`, Windows `%APPDATA%\academic-research-ide\lancedb\`, Linux `$XDG_DATA_HOME/academic-research-ide/lancedb/` veya `~/.local/share/academic-research-ide/lancedb/`)  
Varsayılan gömme (embedding) boyutu: `384` (örn. `BAAI/bge-small-en-v1.5` veya `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`). Boyut, çalışma zamanı yapılandırmasından okunur ve koleksiyon meta verisinde doğrulanır.

### 3.1 `paper_chunks` Tablosu
| Alan Adı | Tip | Açıklama |
|---|---|---|
| `chunk_id` | `string` | Benzersiz parça kimliği (UUIDv4) |
| `paper_id` | `string` | İlişkili `papers.id` |
| `page_number` | `int32` | 1-tabanlı kaynak PDF sayfa numarası |
| `section_name` | `string` | Başlık / bölüm adı (yoksa `""`) |
| `chunk_index` | `int32` | Sayfa içi/makale içi sıra numarası |
| `text` | `string` | Parçanın ham metni |
| `vector` | `float32[384]` | Normalize edilmiş gömme vektörü |

### 3.2 `style_chunks` Tablosu
| Alan Adı | Tip | Açıklama |
|---|---|---|
| `chunk_id` | `string` | Benzersiz stil parçası kimliği (UUIDv4) |
| `style_profile_id` | `string` | İlişkili `style_profiles.id` |
| `source_file` | `string` | Kullanıcının yüklediği referans dosya adı |
| `text` | `string` | Örnek akademik paragraf metni |
| `vector` | `float32[384]` | Normalize edilmiş gömme vektörü |

---

## 4. Bölüm C — Python Pydantic v2 Modelleri (`backend/app/models/schemas.py` Referansı)

```python
from __future__ import annotations

from enum import StrEnum
from typing import Any, Generic, TypeVar
from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class IngestionStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"


class VariableRole(StrEnum):
    INDEPENDENT = "independent"
    DEPENDENT = "dependent"
    MEDIATOR = "mediator"
    MODERATOR = "moderator"
    CONTROL = "control"
    OUTCOME = "outcome"


class RelationshipDirection(StrEnum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    INSIGNIFICANT = "insignificant"
    MIXED = "mixed"
    CURVILINEAR = "curvilinear"


class ClaimType(StrEnum):
    MAIN_FINDING = "main_finding"
    HYPOTHESIS = "hypothesis"
    LIMITATION = "limitation"
    THEORETICAL = "theoretical"
    METHODOLOGICAL = "methodological"


class AuditOverallStatus(StrEnum):
    SUPPORTED = "supported"
    WARNING = "warning"
    CONTRADICTED = "contradicted"
    UNSUPPORTED = "unsupported"


class AuditFindingType(StrEnum):
    UNSUPPORTED_CLAIM = "unsupported_claim"
    CONTRADICTION = "contradiction"
    SUPPORTING_EVIDENCE = "supporting_evidence"
    STYLE_DEVIATION = "style_deviation"
    MISSING_CITATION = "missing_citation"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class JobStatus(StrEnum):
    QUEUED = "queued"
    EXTRACTING_TEXT = "extracting_text"
    PARSING_LLM = "parsing_llm"
    INDEXING_VECTORS = "indexing_vectors"
    COMPLETED = "completed"
    FAILED = "failed"


class ContractModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# --- Çekirdek Alan Modelleri (Core Domain Models) ---


class PaperCreate(ContractModel):
    file_path: str


class Paper(ContractModel):
    id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    journal: str | None = None
    doi: str | None = None
    abstract: str | None = None
    language: str = "en"
    file_path: str
    file_hash_sha256: str
    page_count: int
    sample_size: int | None = None
    sample_population: str | None = None
    sampling_method: str | None = None
    study_context: str | None = None
    statistical_methods: list[str] = Field(default_factory=list)
    research_design: str | None = None
    ingestion_status: IngestionStatus
    ingestion_error: str | None = None
    created_at: str
    updated_at: str


class Claim(ContractModel):
    id: str
    paper_id: str
    claim_text: str
    claim_type: ClaimType
    page_number: int = Field(ge=1)
    section_name: str | None = None
    quote_snippet: str | None = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    created_at: str


class Variable(ContractModel):
    id: str
    canonical_name: str
    normalized_key: str
    display_label: str
    aliases: list[str] = Field(default_factory=list)
    definition: str | None = None
    domain_tag: str | None = None
    created_at: str
    updated_at: str


class PaperVariable(ContractModel):
    id: str
    paper_id: str
    variable_id: str
    role: VariableRole
    local_name: str
    page_number: int | None = Field(default=None, ge=1)


class Relationship(ContractModel):
    id: str
    paper_id: str
    source_variable_id: str
    target_variable_id: str
    source_role: VariableRole | None = None
    target_role: VariableRole | None = None
    direction: RelationshipDirection
    effect_size: float | None = None
    effect_metric: str | None = None
    p_value: str | None = None
    statistical_method: str | None = None
    mediator_variable_id: str | None = None
    moderator_variable_id: str | None = None
    sample_subgroup: str | None = None
    page_number: int = Field(ge=1)
    quote_snippet: str | None = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    created_at: str


class Scale(ContractModel):
    id: str
    paper_id: str
    variable_id: str | None = None
    name: str
    original_authors: str | None = None
    original_year: int | None = None
    item_count: int | None = Field(default=None, gt=0)
    cronbach_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    composite_reliability: float | None = Field(default=None, ge=0.0, le=1.0)
    ave: float | None = Field(default=None, ge=0.0, le=1.0)
    response_format: str | None = None
    language: str | None = None
    sample_size_override: int | None = Field(default=None, ge=0)
    adaptation_notes: str | None = None
    page_number: int = Field(ge=1)
    created_at: str


class StyleProfile(ContractModel):
    id: str
    name: str
    source_files: list[str] = Field(default_factory=list)
    tone: str
    avg_sentence_length: float = Field(ge=0.0)
    passive_voice_ratio: float = Field(ge=0.0, le=1.0)
    hedging_phrases: list[str] = Field(default_factory=list)
    transition_phrases: list[str] = Field(default_factory=list)
    citation_style: str = "APA 7"
    lexical_preferences: dict[str, Any] = Field(default_factory=dict)
    system_prompt_summary: str
    is_active: bool = False
    created_at: str
    updated_at: str


class Draft(ContractModel):
    id: str
    title: str
    content_markdown: str
    style_profile_id: str | None = None
    created_at: str
    updated_at: str


class AuditFinding(ContractModel):
    id: str
    audit_result_id: str
    finding_type: AuditFindingType
    severity: Severity
    excerpt: str
    explanation: str
    suggestion: str | None = None
    related_paper_id: str | None = None
    related_claim_id: str | None = None
    related_relationship_id: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    quote_snippet: str | None = None
    is_dismissed: bool = False
    created_at: str


class AuditResult(ContractModel):
    id: str
    draft_id: str
    paragraph_index: int = Field(ge=0)
    paragraph_hash: str
    paragraph_text: str
    overall_status: AuditOverallStatus
    style_alignment_score: float = Field(ge=0.0, le=1.0)
    evidence_coverage_score: float = Field(ge=0.0, le=1.0)
    summary: str
    model_used: str
    findings: list[AuditFinding] = Field(default_factory=list)
    created_at: str


class IngestionJob(ContractModel):
    id: str
    paper_id: str | None = None
    file_path: str
    status: JobStatus
    progress_percent: int = Field(ge=0, le=100)
    current_stage_message: str | None = None
    error_detail: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str


# --- LLM Yapılandırılmış Çıkarım Şeması (Extraction Payload) ---


class ExtractedMetadata(ContractModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    journal: str | None = None
    doi: str | None = None
    abstract: str | None = None
    language: str = "en"


class ExtractedSampleProfile(ContractModel):
    sample_size: int | None = Field(default=None, ge=0)
    sample_population: str | None = None
    sampling_method: str | None = None
    study_context: str | None = None
    statistical_methods: list[str] = Field(default_factory=list)
    research_design: str | None = None


class ExtractedVariable(ContractModel):
    name: str
    role: VariableRole
    definition: str | None = None
    page_number: int | None = Field(default=None, ge=1)


class ExtractedRelationship(ContractModel):
    source_variable: str
    target_variable: str
    source_role: VariableRole | None = None
    target_role: VariableRole | None = None
    direction: RelationshipDirection
    effect_size: float | None = None
    effect_metric: str | None = None
    p_value: str | None = None
    statistical_method: str | None = None
    mediator_variable: str | None = None
    moderator_variable: str | None = None
    sample_subgroup: str | None = None
    page_number: int = Field(ge=1)
    quote_snippet: str | None = None
    confidence_score: float = Field(default=0.8, ge=0.0, le=1.0)


class ExtractedScale(ContractModel):
    variable_name: str | None = None
    name: str
    original_authors: str | None = None
    original_year: int | None = None
    item_count: int | None = Field(default=None, gt=0)
    cronbach_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    composite_reliability: float | None = Field(default=None, ge=0.0, le=1.0)
    ave: float | None = Field(default=None, ge=0.0, le=1.0)
    response_format: str | None = None
    language: str | None = None
    sample_size_override: int | None = Field(default=None, ge=0)
    adaptation_notes: str | None = None
    page_number: int = Field(ge=1)


class ExtractedClaim(ContractModel):
    claim_text: str
    claim_type: ClaimType
    page_number: int = Field(ge=1)
    section_name: str | None = None
    quote_snippet: str | None = None
    confidence_score: float = Field(default=0.8, ge=0.0, le=1.0)


class PaperExtractionPayload(ContractModel):
    metadata: ExtractedMetadata
    sample_profile: ExtractedSampleProfile
    variables: list[ExtractedVariable] = Field(default_factory=list)
    relationships: list[ExtractedRelationship] = Field(default_factory=list)
    scales: list[ExtractedScale] = Field(default_factory=list)
    claims: list[ExtractedClaim] = Field(default_factory=list)


# --- Sekme Bazlı Görünüm & İstek Modelleri ---


class GraphNode(ContractModel):
    variable_id: str
    canonical_name: str
    display_label: str
    domain_tag: str | None = None
    paper_count: int
    roles_seen: list[VariableRole] = Field(default_factory=list)
    degree_centrality: float = 0.0


class GraphEdge(ContractModel):
    edge_key: str
    source_variable_id: str
    target_variable_id: str
    total_studies: int
    positive_count: int = 0
    negative_count: int = 0
    insignificant_count: int = 0
    mixed_count: int = 0
    curvilinear_count: int = 0
    dominant_direction: RelationshipDirection
    has_contradiction: bool = False
    relationship_ids: list[str] = Field(default_factory=list)


class ResearchGap(ContractModel):
    source_variable_id: str
    source_label: str
    target_variable_id: str
    target_label: str
    co_occurrence_neighbors: int
    direct_study_count: int
    gap_score: float = Field(ge=0.0, le=1.0)
    rationale: str


class ContradictionPaperSide(ContractModel):
    paper_id: str
    paper_title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    sample_size: int | None = None
    statistical_method: str | None = None
    relationship_id: str
    direction: RelationshipDirection
    effect_size: float | None = None
    effect_metric: str | None = None
    p_value: str | None = None
    page_number: int
    quote_snippet: str | None = None


class ContradictionCluster(ContractModel):
    edge_key: str
    source_variable_id: str
    source_label: str
    target_variable_id: str
    target_label: str
    contradiction_score: float = Field(ge=0.0, le=1.0)
    opposing_sides: list[ContradictionPaperSide] = Field(default_factory=list)


class GraphResponse(ContractModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    gaps: list[ResearchGap] = Field(default_factory=list)
    contradictions: list[ContradictionCluster] = Field(default_factory=list)


class ScaleMatrixRow(ContractModel):
    scale_id: str
    paper_id: str
    paper_title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    variable_id: str | None = None
    variable_label: str | None = None
    scale_name: str
    original_authors: str | None = None
    original_year: int | None = None
    item_count: int | None = None
    cronbach_alpha: float | None = None
    composite_reliability: float | None = None
    ave: float | None = None
    response_format: str | None = None
    sample_size: int | None = None
    sample_population: str | None = None
    statistical_methods: list[str] = Field(default_factory=list)
    research_design: str | None = None
    page_number: int


class ScaleMatrixFilter(ContractModel):
    search: str | None = None
    variable_id: str | None = None
    min_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    max_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    min_sample_size: int | None = Field(default=None, ge=0)
    statistical_method: str | None = None
    year_from: int | None = None
    year_to: int | None = None
    sort_by: str = "year"
    sort_dir: str = "desc"
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class ScaleMatrixResponse(ContractModel):
    items: list[ScaleMatrixRow] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class AuditParagraphRequest(ContractModel):
    paragraph_index: int = Field(ge=0)
    paragraph_text: str = Field(min_length=1)
    style_profile_id: str | None = None
    force_refresh: bool = False


class StyleExtractRequest(ContractModel):
    name: str = Field(min_length=1)
    file_paths: list[str] = Field(default_factory=list)
    raw_texts: list[str] = Field(default_factory=list)
    set_active: bool = True


class ApiError(ContractModel):
    error_code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


class PaginatedResponse(ContractModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class HealthResponse(ContractModel):
    status: str
    version: str
    sqlite_ok: bool
    lancedb_ok: bool
    active_llm_provider: str
    active_llm_model: str
```

---

## 5. Bölüm D — TypeScript Arayüzleri (`src/types/contracts.ts` Referansı)

Aşağıdaki TypeScript tanımları Bölüm C'deki Pydantic modelleriyle **1'e 1** eşleşir.

```typescript
export type IngestionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed";

export type VariableRole =
  | "independent"
  | "dependent"
  | "mediator"
  | "moderator"
  | "control"
  | "outcome";

export type RelationshipDirection =
  | "positive"
  | "negative"
  | "insignificant"
  | "mixed"
  | "curvilinear";

export type ClaimType =
  | "main_finding"
  | "hypothesis"
  | "limitation"
  | "theoretical"
  | "methodological";

export type AuditOverallStatus =
  | "supported"
  | "warning"
  | "contradicted"
  | "unsupported";

export type AuditFindingType =
  | "unsupported_claim"
  | "contradiction"
  | "supporting_evidence"
  | "style_deviation"
  | "missing_citation";

export type Severity = "info" | "warning" | "error";

export type JobStatus =
  | "queued"
  | "extracting_text"
  | "parsing_llm"
  | "indexing_vectors"
  | "completed"
  | "failed";

export interface PaperCreate {
  file_path: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  abstract: string | null;
  language: string;
  file_path: string;
  file_hash_sha256: string;
  page_count: number;
  sample_size: number | null;
  sample_population: string | null;
  sampling_method: string | null;
  study_context: string | null;
  statistical_methods: string[];
  research_design: string | null;
  ingestion_status: IngestionStatus;
  ingestion_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Claim {
  id: string;
  paper_id: string;
  claim_text: string;
  claim_type: ClaimType;
  page_number: number;
  section_name: string | null;
  quote_snippet: string | null;
  confidence_score: number;
  created_at: string;
}

export interface Variable {
  id: string;
  canonical_name: string;
  normalized_key: string;
  display_label: string;
  aliases: string[];
  definition: string | null;
  domain_tag: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaperVariable {
  id: string;
  paper_id: string;
  variable_id: string;
  role: VariableRole;
  local_name: string;
  page_number: number | null;
}

export interface Relationship {
  id: string;
  paper_id: string;
  source_variable_id: string;
  target_variable_id: string;
  source_role: VariableRole | null;
  target_role: VariableRole | null;
  direction: RelationshipDirection;
  effect_size: number | null;
  effect_metric: string | null;
  p_value: string | null;
  statistical_method: string | null;
  mediator_variable_id: string | null;
  moderator_variable_id: string | null;
  sample_subgroup: string | null;
  page_number: number;
  quote_snippet: string | null;
  confidence_score: number;
  created_at: string;
}

export interface Scale {
  id: string;
  paper_id: string;
  variable_id: string | null;
  name: string;
  original_authors: string | null;
  original_year: number | null;
  item_count: number | null;
  cronbach_alpha: number | null;
  composite_reliability: number | null;
  ave: number | null;
  response_format: string | null;
  language: string | null;
  sample_size_override: number | null;
  adaptation_notes: string | null;
  page_number: number;
  created_at: string;
}

export interface StyleProfile {
  id: string;
  name: string;
  source_files: string[];
  tone: string;
  avg_sentence_length: number;
  passive_voice_ratio: number;
  hedging_phrases: string[];
  transition_phrases: string[];
  citation_style: string;
  lexical_preferences: Record<string, unknown>;
  system_prompt_summary: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: string;
  title: string;
  content_markdown: string;
  style_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditFinding {
  id: string;
  audit_result_id: string;
  finding_type: AuditFindingType;
  severity: Severity;
  excerpt: string;
  explanation: string;
  suggestion: string | null;
  related_paper_id: string | null;
  related_claim_id: string | null;
  related_relationship_id: string | null;
  page_number: number | null;
  quote_snippet: string | null;
  is_dismissed: boolean;
  created_at: string;
}

export interface AuditResult {
  id: string;
  draft_id: string;
  paragraph_index: number;
  paragraph_hash: string;
  paragraph_text: string;
  overall_status: AuditOverallStatus;
  style_alignment_score: number;
  evidence_coverage_score: number;
  summary: string;
  model_used: string;
  findings: AuditFinding[];
  created_at: string;
}

export interface IngestionJob {
  id: string;
  paper_id: string | null;
  file_path: string;
  status: JobStatus;
  progress_percent: number;
  current_stage_message: string | null;
  error_detail: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface GraphNode {
  variable_id: string;
  canonical_name: string;
  display_label: string;
  domain_tag: string | null;
  paper_count: number;
  roles_seen: VariableRole[];
  degree_centrality: number;
}

export interface GraphEdge {
  edge_key: string;
  source_variable_id: string;
  target_variable_id: string;
  total_studies: number;
  positive_count: number;
  negative_count: number;
  insignificant_count: number;
  mixed_count: number;
  curvilinear_count: number;
  dominant_direction: RelationshipDirection;
  has_contradiction: boolean;
  relationship_ids: string[];
}

export interface ResearchGap {
  source_variable_id: string;
  source_label: string;
  target_variable_id: string;
  target_label: string;
  co_occurrence_neighbors: number;
  direct_study_count: number;
  gap_score: number;
  rationale: string;
}

export interface ContradictionPaperSide {
  paper_id: string;
  paper_title: string;
  authors: string[];
  year: number | null;
  sample_size: number | null;
  statistical_method: string | null;
  relationship_id: string;
  direction: RelationshipDirection;
  effect_size: number | null;
  effect_metric: string | null;
  p_value: string | null;
  page_number: number;
  quote_snippet: string | null;
}

export interface ContradictionCluster {
  edge_key: string;
  source_variable_id: string;
  source_label: string;
  target_variable_id: string;
  target_label: string;
  contradiction_score: number;
  opposing_sides: ContradictionPaperSide[];
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  gaps: ResearchGap[];
  contradictions: ContradictionCluster[];
}

export interface ScaleMatrixRow {
  scale_id: string;
  paper_id: string;
  paper_title: string;
  authors: string[];
  year: number | null;
  variable_id: string | null;
  variable_label: string | null;
  scale_name: string;
  original_authors: string | null;
  original_year: number | null;
  item_count: number | null;
  cronbach_alpha: number | null;
  composite_reliability: number | null;
  ave: number | null;
  response_format: string | null;
  sample_size: number | null;
  sample_population: string | null;
  statistical_methods: string[];
  research_design: string | null;
  page_number: number;
}

export interface ScaleMatrixFilter {
  search?: string | null;
  variable_id?: string | null;
  min_alpha?: number | null;
  max_alpha?: number | null;
  min_sample_size?: number | null;
  statistical_method?: string | null;
  year_from?: number | null;
  year_to?: number | null;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ScaleMatrixResponse {
  items: ScaleMatrixRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditParagraphRequest {
  paragraph_index: number;
  paragraph_text: string;
  style_profile_id?: string | null;
  force_refresh?: boolean;
}

export interface StyleExtractRequest {
  name: string;
  file_paths?: string[];
  raw_texts?: string[];
  set_active?: boolean;
}

export interface ApiError {
  error_code: string;
  message: string;
  details: Record<string, unknown>;
  request_id: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  sqlite_ok: boolean;
  lancedb_ok: boolean;
  active_llm_provider: string;
  active_llm_model: string;
}

export interface ConfigResponse {
  llm_provider: string;
  llm_model: string;
  llm_base_url: string;
  embedding_provider: string;
  embedding_base_url: string | null;
  embedding_model: string;
  embedding_dim: number;
  has_api_key: boolean;
  llm_api_key_masked: string;
}

export interface ConfigPatchRequest {
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_base_url?: string | null;
  llm_api_key?: string | null;
  embedding_provider?: string | null;
  embedding_base_url?: string | null;
  embedding_model?: string | null;
  embedding_dim?: number | null;
}

export interface IngestPathsRequest {
  file_paths: string[];
}

export interface PaperDetailResponse {
  paper: Paper;
  variables: PaperVariable[];
  relationships: Relationship[];
  scales: Scale[];
  claims: Claim[];
}

export interface DeletePaperResponse {
  deleted: boolean;
  paper_id: string;
}

export interface VariableMergeRequest {
  source_variable_ids: string[];
  target_variable_id: string;
}

export interface MethodCountItem {
  method: string;
  count: number;
}

export interface DraftCreateRequest {
  title: string;
  content_markdown?: string;
  style_profile_id?: string | null;
}

export interface DraftUpdateRequest {
  title?: string | null;
  content_markdown?: string | null;
  style_profile_id?: string | null;
}

export interface DeleteDraftResponse {
  deleted: boolean;
  draft_id: string;
}

export interface DismissFindingRequest {
  is_dismissed: boolean;
}
```

---

## 6. Bölüm E — FastAPI Endpoint Sözleşmeleri (`/api/v1`)

### 6.1 Sistem ve Yapılandırma
| Metot | Yol | İstek | Yanıt | Açıklama |
|---|---|---|---|---|
| `GET` | `/api/v1/health` | — | `HealthResponse` | SQLite, LanceDB ve aktif LLM sağlık durumu |
| `GET` | `/api/v1/config` | — | `{ llm_provider, llm_model, llm_base_url, embedding_provider, embedding_base_url, embedding_model, embedding_dim, has_api_key, llm_api_key_masked }` | Yerel/API model ayarları (gizli anahtarlar maskeli) |
| `PATCH` | `/api/v1/config` | Kısmi config JSON (`llm_api_key` dahil) | Güncel `ConfigResponse` | LLM/embedding sağlayıcı, base URL, model ve API key güncelleme |

### 6.2 Ingestion & Makale Havuzu
| Metot | Yol | İstek | Yanıt | Açıklama |
|---|---|---|---|---|
| `POST` | `/api/v1/papers/ingest` | `{ file_paths: string[] }` veya `multipart/form-data` (`files`) | `IngestionJob[]` (`202 Accepted`) | Tekli veya toplu PDF alımını kuyruğa alır; SHA-256 tekilliği kontrol eder |
| `GET` | `/api/v1/jobs/{job_id}` | — | `IngestionJob` | İşlem durumu ve ilerleme yüzdesi |
| `GET` | `/api/v1/jobs/{job_id}/stream` | — | `text/event-stream` (SSE `IngestionJob` eventleri) | Gerçek zamanlı pipeline aşama yayını |
| `GET` | `/api/v1/papers` | Query: `status`, `search`, `limit`, `offset` | `PaginatedResponse[Paper]` | Makale havuzu listesi |
| `GET` | `/api/v1/papers/{paper_id}` | — | `{ paper: Paper, variables: PaperVariable[], relationships: Relationship[], scales: Scale[], claims: Claim[] }` | Makale tam detayı |
| `DELETE` | `/api/v1/papers/{paper_id}` | — | `{ deleted: true, paper_id: string }` | SQLite cascade + LanceDB chunk temizliği |
| `POST` | `/api/v1/papers/{paper_id}/reprocess` | — | `IngestionJob` (`202 Accepted`) | Makaleyi yeniden ayrıştırır |

### 6.3 Sekme 1 — Kavram, Boşluk & Çelişki Haritası
| Metot | Yol | İstek / Query | Yanıt | Açıklama |
|---|---|---|---|---|
| `GET` | `/api/v1/graph` | `min_paper_count`, `direction`, `year_from`, `year_to`, `variable_ids` | `GraphResponse` | Düğüm, kenar, araştırma boşluğu ve çelişki kümelerini döner |
| `GET` | `/api/v1/graph/gaps` | `limit`, `min_gap_score` | `ResearchGap[]` | Yüksek ortak-komşulu ancak doğrudan çalışılmamış çiftler |
| `GET` | `/api/v1/graph/contradictions` | `edge_key` (opsiyonel) | `ContradictionCluster[]` | Zıt yönlü bulguları makale + sayfa referansıyla yan yana döner |
| `POST` | `/api/v1/variables/merge` | `{ source_variable_ids: string[], target_variable_id: string }` | `Variable` | Yinelenen değişkenleri tek kanonik değişkende birleştirir |

### 6.4 Sekme 2 — Ölçek & Yöntem Matrisi
| Metot | Yol | İstek / Query | Yanıt | Açıklama |
|---|---|---|---|---|
| `GET` | `/api/v1/matrix/scales` | `ScaleMatrixFilter` query parametreleri | `ScaleMatrixResponse` | Filtrelenebilir, sıralanabilir ölçek ve yöntem tablosu |
| `GET` | `/api/v1/matrix/methods` | — | `Array<{ method: string, count: number }>` | Filtre açılır menüsü için tekil istatistiksel yöntem sayımları |
| `GET` | `/api/v1/matrix/export` | `format=csv|json` + `ScaleMatrixFilter` | İndirilebilir `text/csv` veya `application/json` | Matris dışa aktarımı |

### 6.5 Sekme 3 — Taslak, Stil Profili & Kanıt/Çelişki Denetçisi
| Metot | Yol | İstek | Yanıt | Açıklama |
|---|---|---|---|---|
| `GET` | `/api/v1/style-profiles` | — | `StyleProfile[]` | Kayıtlı stil profillerini listeler |
| `POST` | `/api/v1/style-profiles/extract` | `StyleExtractRequest` | `StyleProfile` | Kullanıcının geçmiş metinlerinden stil profili çıkarır ve `style_chunks` indeksler |
| `PATCH` | `/api/v1/style-profiles/{profile_id}/activate` | — | `StyleProfile` | Belirtilen stil profilini aktif hale getirir |
| `GET` | `/api/v1/drafts` | — | `Draft[]` | Taslak listesi |
| `POST` | `/api/v1/drafts` | `{ title: string, content_markdown?: string, style_profile_id?: string | null }` | `Draft` | Yeni taslak oluşturur |
| `GET` | `/api/v1/drafts/{draft_id}` | — | `Draft` | Taslak detayı |
| `PUT` | `/api/v1/drafts/{draft_id}` | `{ title?: string, content_markdown?: string, style_profile_id?: string | null }` | `Draft` | Taslak içeriğini kaydeder |
| `DELETE` | `/api/v1/drafts/{draft_id}` | — | `{ deleted: true, draft_id: string }` | Taslağı siler |
| `GET` | `/api/v1/drafts/{draft_id}/audits` | — | `AuditResult[]` | Taslağa ait kayıtlı son paragraf denetim sonuçlarını bulgularıyla döner |
| `POST` | `/api/v1/drafts/{draft_id}/audit` | `AuditParagraphRequest` | `AuditResult` | Paragrafı yerel makale havuzu (SQLite + LanceDB) ve stil profiliyle denetler |
| `PATCH` | `/api/v1/audit-findings/{finding_id}/dismiss` | `{ is_dismissed: boolean }` | `AuditFinding` | Kullanıcı tarafından denetim bulgusunu kapatır/açar |

### 6.6 Standart Hata Zarfı (Error Envelope)
Tüm `400`, `404`, `409`, `422`, `500`, `501`, `503` yanıtları şu zarfla döner:
```json
{
  "error_code": "PAPER_PARSE_FAILED",
  "message": "PDF metni çıkarılamadı veya dosya bozuk.",
  "details": { "file_path": "/path/to/paper.pdf" },
  "request_id": "req-uuid"
}
```
