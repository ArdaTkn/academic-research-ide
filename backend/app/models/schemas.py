from __future__ import annotations

from enum import StrEnum
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    file_path: str = Field(min_length=1)


class Paper(ContractModel):
    id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = Field(default=None, ge=1800, le=2100)
    journal: str | None = None
    doi: str | None = None
    abstract: str | None = None
    language: str = "en"
    file_path: str
    file_hash_sha256: str
    page_count: int = Field(ge=1)
    sample_size: int | None = Field(default=None, ge=0)
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
    claim_text: str = Field(min_length=1)
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
    name: str = Field(min_length=1)
    original_authors: str | None = None
    original_year: int | None = Field(default=None, ge=1800, le=2100)
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


def _require_non_blank(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Metin alanı boş bırakılamaz.")
    return cleaned


class ExtractedMetadata(ContractModel):
    title: str = Field(min_length=1)
    authors: list[str] = Field(default_factory=list)
    year: int | None = Field(default=None, ge=1800, le=2100)
    journal: str | None = None
    doi: str | None = None
    abstract: str | None = None
    language: str = "en"

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        return _require_non_blank(v)


class ExtractedSampleProfile(ContractModel):
    sample_size: int | None = Field(default=None, ge=0)
    sample_population: str | None = None
    sampling_method: str | None = None
    study_context: str | None = None
    statistical_methods: list[str] = Field(default_factory=list)
    research_design: str | None = None


class ExtractedVariable(ContractModel):
    name: str = Field(min_length=1)
    role: VariableRole
    definition: str | None = None
    page_number: int | None = Field(default=None, ge=1)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        return _require_non_blank(v)


class ExtractedRelationship(ContractModel):
    source_variable: str = Field(min_length=1)
    target_variable: str = Field(min_length=1)
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

    @field_validator("source_variable", "target_variable")
    @classmethod
    def _validate_var_names(cls, v: str) -> str:
        return _require_non_blank(v)


class ExtractedScale(ContractModel):
    variable_name: str | None = None
    name: str = Field(min_length=1)
    original_authors: str | None = None
    original_year: int | None = Field(default=None, ge=1800, le=2100)
    item_count: int | None = Field(default=None, gt=0)
    cronbach_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    composite_reliability: float | None = Field(default=None, ge=0.0, le=1.0)
    ave: float | None = Field(default=None, ge=0.0, le=1.0)
    response_format: str | None = None
    language: str | None = None
    sample_size_override: int | None = Field(default=None, ge=0)
    adaptation_notes: str | None = None
    page_number: int = Field(ge=1)

    @field_validator("name")
    @classmethod
    def _validate_scale_name(cls, v: str) -> str:
        return _require_non_blank(v)


class ExtractedClaim(ContractModel):
    claim_text: str = Field(min_length=1)
    claim_type: ClaimType
    page_number: int = Field(ge=1)
    section_name: str | None = None
    quote_snippet: str | None = None
    confidence_score: float = Field(default=0.8, ge=0.0, le=1.0)

    @field_validator("claim_text")
    @classmethod
    def _validate_claim_text(cls, v: str) -> str:
        return _require_non_blank(v)


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
    page_number: int = Field(ge=1)
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
    page_number: int = Field(ge=1)


class ScaleMatrixFilter(ContractModel):
    search: str | None = None
    variable_id: str | None = None
    min_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    max_alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    min_sample_size: int | None = Field(default=None, ge=0)
    statistical_method: str | None = None
    year_from: int | None = Field(default=None, ge=1800, le=2100)
    year_to: int | None = Field(default=None, ge=1800, le=2100)
    sort_by: str = "year"
    sort_dir: Literal["asc", "desc"] = "desc"
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


# --- Endpoint İstek / Yanıt Yardımcıları (Bölüm E) ---


class ConfigResponse(ContractModel):
    llm_provider: str
    llm_model: str
    llm_base_url: str
    embedding_provider: str
    embedding_base_url: str | None = None
    embedding_model: str
    embedding_dim: int
    has_api_key: bool
    llm_api_key_masked: str = ""


class ConfigPatchRequest(ContractModel):
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    embedding_provider: str | None = None
    embedding_base_url: str | None = None
    embedding_model: str | None = None
    embedding_dim: int | None = Field(default=None, gt=0)


class IngestPathsRequest(ContractModel):
    file_paths: list[str] = Field(min_length=1)


class PaperDetailResponse(ContractModel):
    paper: Paper
    variables: list[PaperVariable] = Field(default_factory=list)
    relationships: list[Relationship] = Field(default_factory=list)
    scales: list[Scale] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)


class DeletePaperResponse(ContractModel):
    deleted: bool
    paper_id: str


class VariableMergeRequest(ContractModel):
    source_variable_ids: list[str] = Field(min_length=1)
    target_variable_id: str = Field(min_length=1)


class MethodCountItem(ContractModel):
    method: str
    count: int


class DraftCreateRequest(ContractModel):
    title: str = Field(min_length=1)
    content_markdown: str = ""
    style_profile_id: str | None = None


class DraftUpdateRequest(ContractModel):
    title: str | None = None
    content_markdown: str | None = None
    style_profile_id: str | None = None


class DeleteDraftResponse(ContractModel):
    deleted: bool
    draft_id: str


class DismissFindingRequest(ContractModel):
    is_dismissed: bool
