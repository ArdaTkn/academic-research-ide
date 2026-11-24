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
