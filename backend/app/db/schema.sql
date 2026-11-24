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
    grounding_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (grounding_status IN ('verified', 'partial', 'unverified')),
    grounding_score REAL NOT NULL DEFAULT 0.0 CHECK (grounding_score >= 0.0 AND grounding_score <= 1.0),
    grounding_note TEXT,
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
    grounding_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (grounding_status IN ('verified', 'partial', 'unverified')),
    grounding_score REAL NOT NULL DEFAULT 0.0 CHECK (grounding_score >= 0.0 AND grounding_score <= 1.0),
    grounding_note TEXT,
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
    quote_snippet TEXT,
    grounding_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (grounding_status IN ('verified', 'partial', 'unverified')),
    grounding_score REAL NOT NULL DEFAULT 0.0 CHECK (grounding_score >= 0.0 AND grounding_score <= 1.0),
    grounding_note TEXT,
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
