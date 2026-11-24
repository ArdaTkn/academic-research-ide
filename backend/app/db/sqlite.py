from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.core.errors import ConflictError, NotFoundError
from app.models.schemas import (
    AuditFinding,
    AuditFindingType,
    AuditOverallStatus,
    AuditResult,
    Claim,
    ClaimType,
    ContradictionCluster,
    ContradictionPaperSide,
    Draft,
    GraphEdge,
    GraphNode,
    GraphResponse,
    IngestionJob,
    IngestionStatus,
    JobStatus,
    MethodCountItem,
    Paper,
    PaperDetailResponse,
    PaperExtractionPayload,
    PaperVariable,
    Relationship,
    RelationshipDirection,
    ResearchGap,
    Scale,
    ScaleMatrixFilter,
    ScaleMatrixResponse,
    ScaleMatrixRow,
    Severity,
    StyleProfile,
    Variable,
    VariableRole,
)
from app.pipeline.normalizer import clean_display_label, normalize_variable_key


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SQLiteDatabase:
    """Manages SQLite connections with strict WAL, FK, and busy_timeout pragmas."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._schema_path = Path(__file__).resolve().parent / "schema.sql"

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=10.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self) -> None:
        ddl = self._schema_path.read_text(encoding="utf-8")
        with self.connect() as conn:
            conn.executescript(ddl)

    def health_check(self) -> bool:
        try:
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT count(*) AS cnt FROM sqlite_master WHERE type='table' AND name='papers'"
                ).fetchone()
                return bool(row and row["cnt"] == 1)
        except Exception:
            return False


class ResearchRepository:
    """Typed repository implementing all SQLite queries per SCHEMA_AND_CONTRACTS.md."""

    _MATRIX_SORT_COLUMNS: dict[str, str] = {
        "year": "p.year",
        "cronbach_alpha": "s.cronbach_alpha",
        "item_count": "s.item_count",
        "sample_size": "COALESCE(s.sample_size_override, p.sample_size)",
        "scale_name": "s.name",
        "paper_title": "p.title",
        "page_number": "s.page_number",
    }

    def __init__(self, db: SQLiteDatabase) -> None:
        self.db = db

    # --- Row Mappers ---

    @staticmethod
    def _row_to_paper(row: sqlite3.Row) -> Paper:
        return Paper(
            id=row["id"],
            title=row["title"],
            authors=json.loads(row["authors_json"] or "[]"),
            year=row["year"],
            journal=row["journal"],
            doi=row["doi"],
            abstract=row["abstract"],
            language=row["language"],
            file_path=row["file_path"],
            file_hash_sha256=row["file_hash_sha256"],
            page_count=row["page_count"],
            sample_size=row["sample_size"],
            sample_population=row["sample_population"],
            sampling_method=row["sampling_method"],
            study_context=row["study_context"],
            statistical_methods=json.loads(row["statistical_methods_json"] or "[]"),
            research_design=row["research_design"],
            ingestion_status=IngestionStatus(row["ingestion_status"]),
            ingestion_error=row["ingestion_error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_claim(row: sqlite3.Row) -> Claim:
        return Claim(
            id=row["id"],
            paper_id=row["paper_id"],
            claim_text=row["claim_text"],
            claim_type=ClaimType(row["claim_type"]),
            page_number=row["page_number"],
            section_name=row["section_name"],
            quote_snippet=row["quote_snippet"],
            confidence_score=row["confidence_score"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_variable(row: sqlite3.Row) -> Variable:
        return Variable(
            id=row["id"],
            canonical_name=row["canonical_name"],
            normalized_key=row["normalized_key"],
            display_label=row["display_label"],
            aliases=json.loads(row["aliases_json"] or "[]"),
            definition=row["definition"],
            domain_tag=row["domain_tag"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_paper_variable(row: sqlite3.Row) -> PaperVariable:
        return PaperVariable(
            id=row["id"],
            paper_id=row["paper_id"],
            variable_id=row["variable_id"],
            role=VariableRole(row["role"]),
            local_name=row["local_name"],
            page_number=row["page_number"],
        )

    @staticmethod
    def _row_to_relationship(row: sqlite3.Row) -> Relationship:
        return Relationship(
            id=row["id"],
            paper_id=row["paper_id"],
            source_variable_id=row["source_variable_id"],
            target_variable_id=row["target_variable_id"],
            source_role=VariableRole(row["source_role"]) if row["source_role"] else None,
            target_role=VariableRole(row["target_role"]) if row["target_role"] else None,
            direction=RelationshipDirection(row["direction"]),
            effect_size=row["effect_size"],
            effect_metric=row["effect_metric"],
            p_value=row["p_value"],
            statistical_method=row["statistical_method"],
            mediator_variable_id=row["mediator_variable_id"],
            moderator_variable_id=row["moderator_variable_id"],
            sample_subgroup=row["sample_subgroup"],
            page_number=row["page_number"],
            quote_snippet=row["quote_snippet"],
            confidence_score=row["confidence_score"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_scale(row: sqlite3.Row) -> Scale:
        return Scale(
            id=row["id"],
            paper_id=row["paper_id"],
            variable_id=row["variable_id"],
            name=row["name"],
            original_authors=row["original_authors"],
            original_year=row["original_year"],
            item_count=row["item_count"],
            cronbach_alpha=row["cronbach_alpha"],
            composite_reliability=row["composite_reliability"],
            ave=row["ave"],
            response_format=row["response_format"],
            language=row["language"],
            sample_size_override=row["sample_size_override"],
            adaptation_notes=row["adaptation_notes"],
            page_number=row["page_number"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_job(row: sqlite3.Row) -> IngestionJob:
        return IngestionJob(
            id=row["id"],
            paper_id=row["paper_id"],
            file_path=row["file_path"],
            status=JobStatus(row["status"]),
            progress_percent=row["progress_percent"],
            current_stage_message=row["current_stage_message"],
            error_detail=row["error_detail"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_style_profile(row: sqlite3.Row) -> StyleProfile:
        return StyleProfile(
            id=row["id"],
            name=row["name"],
            source_files=json.loads(row["source_files_json"] or "[]"),
            tone=row["tone"],
            avg_sentence_length=row["avg_sentence_length"],
            passive_voice_ratio=row["passive_voice_ratio"],
            hedging_phrases=json.loads(row["hedging_phrases_json"] or "[]"),
            transition_phrases=json.loads(row["transition_phrases_json"] or "[]"),
            citation_style=row["citation_style"],
            lexical_preferences=json.loads(row["lexical_preferences_json"] or "{}"),
            system_prompt_summary=row["system_prompt_summary"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_draft(row: sqlite3.Row) -> Draft:
        return Draft(
            id=row["id"],
            title=row["title"],
            content_markdown=row["content_markdown"],
            style_profile_id=row["style_profile_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_audit_finding(row: sqlite3.Row) -> AuditFinding:
        return AuditFinding(
            id=row["id"],
            audit_result_id=row["audit_result_id"],
            finding_type=AuditFindingType(row["finding_type"]),
            severity=Severity(row["severity"]),
            excerpt=row["excerpt"],
            explanation=row["explanation"],
            suggestion=row["suggestion"],
            related_paper_id=row["related_paper_id"],
            related_claim_id=row["related_claim_id"],
            related_relationship_id=row["related_relationship_id"],
            page_number=row["page_number"],
            quote_snippet=row["quote_snippet"],
            is_dismissed=bool(row["is_dismissed"]),
            created_at=row["created_at"],
        )

    # --- Ingestion Jobs ---

    def create_job(self, file_path: str, paper_id: str | None = None) -> IngestionJob:
        job_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO ingestion_jobs (
                    id, paper_id, file_path, status, progress_percent,
                    current_stage_message, created_at
                ) VALUES (?, ?, ?, 'queued', 0, 'Kuyruğa alındı', ?)
                """,
                (job_id, paper_id, file_path, now),
            )
            row = conn.execute("SELECT * FROM ingestion_jobs WHERE id = ?", (job_id,)).fetchone()
        assert row is not None
        return self._row_to_job(row)

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress_percent: int | None = None,
        current_stage_message: str | None = None,
        error_detail: str | None = None,
        paper_id: str | None = None,
        started_at: str | None = None,
        completed_at: str | None = None,
    ) -> IngestionJob:
        fields: list[str] = []
        params: list[Any] = []
        if status is not None:
            fields.append("status = ?")
            params.append(status.value)
        if progress_percent is not None:
            fields.append("progress_percent = ?")
            params.append(progress_percent)
        if current_stage_message is not None:
            fields.append("current_stage_message = ?")
            params.append(current_stage_message)
        if error_detail is not None:
            fields.append("error_detail = ?")
            params.append(error_detail)
        if paper_id is not None:
            fields.append("paper_id = ?")
            params.append(paper_id)
        if started_at is not None:
            fields.append("started_at = ?")
            params.append(started_at)
        if completed_at is not None:
            fields.append("completed_at = ?")
            params.append(completed_at)

        if not fields:
            return self.get_job(job_id)

        params.append(job_id)
        with self.db.connect() as conn:
            conn.execute(
                f"UPDATE ingestion_jobs SET {', '.join(fields)} WHERE id = ?",
                params,
            )
            row = conn.execute("SELECT * FROM ingestion_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="JOB_NOT_FOUND", message="İşlem kaydı bulunamadı.", details={"job_id": job_id})
        return self._row_to_job(row)

    def get_job(self, job_id: str) -> IngestionJob:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM ingestion_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="JOB_NOT_FOUND", message="İşlem kaydı bulunamadı.", details={"job_id": job_id})
        return self._row_to_job(row)

    # --- Papers & Validated Extraction Persistence ---

    def get_paper_by_hash(self, file_hash_sha256: str) -> Paper | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM papers WHERE file_hash_sha256 = ?",
                (file_hash_sha256,),
            ).fetchone()
        return self._row_to_paper(row) if row else None

    def create_or_reset_paper_stub(
        self,
        *,
        file_path: str,
        file_hash_sha256: str,
        page_count: int,
        title_hint: str,
        paper_id: str | None = None,
    ) -> Paper:
        now = utc_now_iso()
        with self.db.connect() as conn:
            if paper_id:
                existing = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
                if existing is None:
                    raise NotFoundError(
                        error_code="PAPER_NOT_FOUND",
                        message="Yeniden işlenecek makale bulunamadı.",
                        details={"paper_id": paper_id},
                    )
                conn.execute(
                    """
                    UPDATE papers
                    SET file_path = ?, file_hash_sha256 = ?, page_count = ?,
                        ingestion_status = 'processing', ingestion_error = NULL, updated_at = ?
                    WHERE id = ?
                    """,
                    (file_path, file_hash_sha256, page_count, now, paper_id),
                )
                row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
                assert row is not None
                return self._row_to_paper(row)

            new_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO papers (
                    id, title, file_path, file_hash_sha256, page_count,
                    ingestion_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)
                """,
                (new_id, title_hint, file_path, file_hash_sha256, page_count, now, now),
            )
            row = conn.execute("SELECT * FROM papers WHERE id = ?", (new_id,)).fetchone()
        assert row is not None
        return self._row_to_paper(row)

    def mark_paper_failed(self, paper_id: str, error_message: str) -> None:
        now = utc_now_iso()
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE papers
                SET ingestion_status = 'failed', ingestion_error = ?, updated_at = ?
                WHERE id = ?
                """,
                (error_message, now, paper_id),
            )

    def mark_paper_completed(self, paper_id: str) -> Paper:
        now = utc_now_iso()
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE papers
                SET ingestion_status = 'completed', ingestion_error = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, paper_id),
            )
            row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="PAPER_NOT_FOUND", message="Makale bulunamadı.", details={"paper_id": paper_id})
        return self._row_to_paper(row)

    def _get_or_create_variable_conn(
        self,
        conn: sqlite3.Connection,
        *,
        name: str,
        definition: str | None = None,
    ) -> str:
        display = clean_display_label(name)
        key = normalize_variable_key(display)
        if not key:
            key = f"var_{uuid.uuid4().hex[:8]}"
        now = utc_now_iso()

        row = conn.execute("SELECT * FROM variables WHERE normalized_key = ?", (key,)).fetchone()
        if row is not None:
            aliases: list[str] = json.loads(row["aliases_json"] or "[]")
            if display != row["canonical_name"] and display not in aliases:
                aliases.append(display)
                conn.execute(
                    "UPDATE variables SET aliases_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(aliases), now, row["id"]),
                )
            if definition and not row["definition"]:
                conn.execute(
                    "UPDATE variables SET definition = ?, updated_at = ? WHERE id = ?",
                    (definition, now, row["id"]),
                )
            return str(row["id"])

        var_id = str(uuid.uuid4())
        # canonical_name UNIQUE çakışmasına karşı kontrol
        existing_name = conn.execute(
            "SELECT id FROM variables WHERE canonical_name = ?", (display,)
        ).fetchone()
        canonical_name = display if existing_name is None else f"{display} ({var_id[:6]})"

        conn.execute(
            """
            INSERT INTO variables (
                id, canonical_name, normalized_key, display_label, aliases_json,
                definition, created_at, updated_at
            ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)
            """,
            (var_id, canonical_name, key, display, definition, now, now),
        )
        return var_id

    def persist_validated_extraction(
        self,
        *,
        paper_id: str,
        payload: PaperExtractionPayload,
        status: IngestionStatus = IngestionStatus.PROCESSING,
    ) -> Paper:
        """Atomically persist a validated PaperExtractionPayload into SQLite and FTS5."""
        now = utc_now_iso()
        raw_json = payload.model_dump_json()

        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM papers WHERE id = ?", (paper_id,)).fetchone()
            if existing is None:
                raise NotFoundError(error_code="PAPER_NOT_FOUND", message="Makale bulunamadı.", details={"paper_id": paper_id})

            # Yeniden işleme durumuna karşı eski çıkarım alt kayıtlarını temizle
            conn.execute("DELETE FROM claims_fts WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM papers_fts WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM claims WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM paper_variables WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM relationships WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM scales WHERE paper_id = ?", (paper_id,))

            meta = payload.metadata
            sample = payload.sample_profile

            conn.execute(
                """
                UPDATE papers SET
                    title = ?, authors_json = ?, year = ?, journal = ?, doi = ?,
                    abstract = ?, language = ?, sample_size = ?, sample_population = ?,
                    sampling_method = ?, study_context = ?, statistical_methods_json = ?,
                    research_design = ?, ingestion_status = ?, ingestion_error = NULL,
                    raw_extraction_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    meta.title,
                    json.dumps(meta.authors),
                    meta.year,
                    meta.journal,
                    meta.doi,
                    meta.abstract,
                    meta.language,
                    sample.sample_size,
                    sample.sample_population,
                    sample.sampling_method,
                    sample.study_context,
                    json.dumps(sample.statistical_methods),
                    sample.research_design,
                    status.value,
                    raw_json,
                    now,
                    paper_id,
                ),
            )

            conn.execute(
                """
                INSERT INTO papers_fts (paper_id, title, abstract, sample_population, study_context)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    paper_id,
                    meta.title,
                    meta.abstract or "",
                    sample.sample_population or "",
                    sample.study_context or "",
                ),
            )

            var_cache: dict[str, str] = {}
            for var in payload.variables:
                var_id = self._get_or_create_variable_conn(conn, name=var.name, definition=var.definition)
                var_cache[normalize_variable_key(var.name)] = var_id
                conn.execute(
                    """
                    INSERT INTO paper_variables (id, paper_id, variable_id, role, local_name, page_number)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(paper_id, variable_id, role) DO UPDATE SET
                        local_name = excluded.local_name,
                        page_number = COALESCE(excluded.page_number, paper_variables.page_number)
                    """,
                    (str(uuid.uuid4()), paper_id, var_id, var.role.value, clean_display_label(var.name), var.page_number),
                )

            def resolve_var(name: str) -> str:
                key = normalize_variable_key(name)
                if key in var_cache:
                    return var_cache[key]
                vid = self._get_or_create_variable_conn(conn, name=name)
                var_cache[key] = vid
                return vid

            for rel in payload.relationships:
                src_id = resolve_var(rel.source_variable)
                tgt_id = resolve_var(rel.target_variable)
                med_id = resolve_var(rel.mediator_variable) if rel.mediator_variable else None
                mod_id = resolve_var(rel.moderator_variable) if rel.moderator_variable else None
                conn.execute(
                    """
                    INSERT INTO relationships (
                        id, paper_id, source_variable_id, target_variable_id,
                        source_role, target_role, direction, effect_size, effect_metric,
                        p_value, statistical_method, mediator_variable_id, moderator_variable_id,
                        sample_subgroup, page_number, quote_snippet, confidence_score, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        paper_id,
                        src_id,
                        tgt_id,
                        rel.source_role.value if rel.source_role else None,
                        rel.target_role.value if rel.target_role else None,
                        rel.direction.value,
                        rel.effect_size,
                        rel.effect_metric,
                        rel.p_value,
                        rel.statistical_method,
                        med_id,
                        mod_id,
                        rel.sample_subgroup,
                        rel.page_number,
                        rel.quote_snippet,
                        rel.confidence_score,
                        now,
                    ),
                )

            for scale in payload.scales:
                var_id = resolve_var(scale.variable_name) if scale.variable_name else None
                conn.execute(
                    """
                    INSERT INTO scales (
                        id, paper_id, variable_id, name, original_authors, original_year,
                        item_count, cronbach_alpha, composite_reliability, ave,
                        response_format, language, sample_size_override, adaptation_notes,
                        page_number, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        paper_id,
                        var_id,
                        scale.name.strip(),
                        scale.original_authors,
                        scale.original_year,
                        scale.item_count,
                        scale.cronbach_alpha,
                        scale.composite_reliability,
                        scale.ave,
                        scale.response_format,
                        scale.language,
                        scale.sample_size_override,
                        scale.adaptation_notes,
                        scale.page_number,
                        now,
                    ),
                )

            for claim in payload.claims:
                claim_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO claims (
                        id, paper_id, claim_text, claim_type, page_number,
                        section_name, quote_snippet, confidence_score, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        claim_id,
                        paper_id,
                        claim.claim_text.strip(),
                        claim.claim_type.value,
                        claim.page_number,
                        claim.section_name,
                        claim.quote_snippet,
                        claim.confidence_score,
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO claims_fts (claim_id, paper_id, claim_text, quote_snippet)
                    VALUES (?, ?, ?, ?)
                    """,
                    (claim_id, paper_id, claim.claim_text.strip(), claim.quote_snippet or ""),
                )

            row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        assert row is not None
        return self._row_to_paper(row)

    def get_paper(self, paper_id: str) -> Paper:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="PAPER_NOT_FOUND", message="Makale bulunamadı.", details={"paper_id": paper_id})
        return self._row_to_paper(row)

    def list_papers(
        self,
        *,
        status: IngestionStatus | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Paper], int]:
        where: list[str] = []
        params: list[Any] = []
        if status is not None:
            where.append("p.ingestion_status = ?")
            params.append(status.value)
        if search and search.strip():
            term = f"%{search.strip()}%"
            where.append(
                "(p.title LIKE ? OR p.abstract LIKE ? OR p.authors_json LIKE ? OR p.id IN (SELECT paper_id FROM papers_fts WHERE papers_fts MATCH ?))"
            )
            fts_query = " ".join(
                f'"{tok.replace(chr(34), "")}"' for tok in search.strip().split() if tok
            ) or '""'
            params.extend([term, term, term, fts_query])

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        with self.db.connect() as conn:
            try:
                total_row = conn.execute(
                    f"SELECT COUNT(*) AS cnt FROM papers p {where_sql}", params
                ).fetchone()
                rows = conn.execute(
                    f"SELECT p.* FROM papers p {where_sql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?",
                    [*params, limit, offset],
                ).fetchall()
            except sqlite3.OperationalError:
                # FTS söz dizimi özel karakter içerirse LIKE sorgusuna düş
                where_like: list[str] = []
                params_like: list[Any] = []
                if status is not None:
                    where_like.append("p.ingestion_status = ?")
                    params_like.append(status.value)
                if search and search.strip():
                    term = f"%{search.strip()}%"
                    where_like.append("(p.title LIKE ? OR p.abstract LIKE ? OR p.authors_json LIKE ?)")
                    params_like.extend([term, term, term])
                where_sql_like = ("WHERE " + " AND ".join(where_like)) if where_like else ""
                total_row = conn.execute(
                    f"SELECT COUNT(*) AS cnt FROM papers p {where_sql_like}", params_like
                ).fetchone()
                rows = conn.execute(
                    f"SELECT p.* FROM papers p {where_sql_like} ORDER BY p.created_at DESC LIMIT ? OFFSET ?",
                    [*params_like, limit, offset],
                ).fetchall()

        total = int(total_row["cnt"]) if total_row else 0
        return [self._row_to_paper(r) for r in rows], total

    def get_paper_detail(self, paper_id: str) -> PaperDetailResponse:
        with self.db.connect() as conn:
            p_row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
            if p_row is None:
                raise NotFoundError(error_code="PAPER_NOT_FOUND", message="Makale bulunamadı.", details={"paper_id": paper_id})
            pv_rows = conn.execute("SELECT * FROM paper_variables WHERE paper_id = ?", (paper_id,)).fetchall()
            rel_rows = conn.execute("SELECT * FROM relationships WHERE paper_id = ? ORDER BY page_number", (paper_id,)).fetchall()
            scale_rows = conn.execute("SELECT * FROM scales WHERE paper_id = ? ORDER BY page_number", (paper_id,)).fetchall()
            claim_rows = conn.execute("SELECT * FROM claims WHERE paper_id = ? ORDER BY page_number", (paper_id,)).fetchall()

        return PaperDetailResponse(
            paper=self._row_to_paper(p_row),
            variables=[self._row_to_paper_variable(r) for r in pv_rows],
            relationships=[self._row_to_relationship(r) for r in rel_rows],
            scales=[self._row_to_scale(r) for r in scale_rows],
            claims=[self._row_to_claim(r) for r in claim_rows],
        )

    def delete_paper(self, paper_id: str) -> None:
        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM papers WHERE id = ?", (paper_id,)).fetchone()
            if existing is None:
                raise NotFoundError(error_code="PAPER_NOT_FOUND", message="Silinecek makale bulunamadı.", details={"paper_id": paper_id})
            conn.execute("DELETE FROM claims_fts WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM papers_fts WHERE paper_id = ?", (paper_id,))
            conn.execute("DELETE FROM papers WHERE id = ?", (paper_id,))

    # --- Variables & Merge ---

    def get_variable(self, variable_id: str) -> Variable:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM variables WHERE id = ?", (variable_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="VARIABLE_NOT_FOUND", message="Değişken bulunamadı.", details={"variable_id": variable_id})
        return self._row_to_variable(row)

    def merge_variables(self, source_variable_ids: list[str], target_variable_id: str) -> Variable:
        if target_variable_id in source_variable_ids:
            source_variable_ids = [sid for sid in source_variable_ids if sid != target_variable_id]
        if not source_variable_ids:
            return self.get_variable(target_variable_id)

        now = utc_now_iso()
        with self.db.connect() as conn:
            target_row = conn.execute("SELECT * FROM variables WHERE id = ?", (target_variable_id,)).fetchone()
            if target_row is None:
                raise NotFoundError(
                    error_code="VARIABLE_NOT_FOUND",
                    message="Hedef değişken bulunamadı.",
                    details={"variable_id": target_variable_id},
                )

            aliases: list[str] = json.loads(target_row["aliases_json"] or "[]")
            for src_id in source_variable_ids:
                src_row = conn.execute("SELECT * FROM variables WHERE id = ?", (src_id,)).fetchone()
                if src_row is None:
                    raise NotFoundError(
                        error_code="VARIABLE_NOT_FOUND",
                        message="Birleştirilecek kaynak değişken bulunamadı.",
                        details={"variable_id": src_id},
                    )
                for candidate in [src_row["canonical_name"], src_row["display_label"], *json.loads(src_row["aliases_json"] or "[]")]:
                    if candidate != target_row["canonical_name"] and candidate not in aliases:
                        aliases.append(candidate)

                # paper_variables UNIQUE(paper_id, variable_id, role) çakışmalarını çöz
                src_pvs = conn.execute("SELECT * FROM paper_variables WHERE variable_id = ?", (src_id,)).fetchall()
                for pv in src_pvs:
                    dup = conn.execute(
                        "SELECT id FROM paper_variables WHERE paper_id = ? AND variable_id = ? AND role = ?",
                        (pv["paper_id"], target_variable_id, pv["role"]),
                    ).fetchone()
                    if dup:
                        conn.execute("DELETE FROM paper_variables WHERE id = ?", (pv["id"],))
                    else:
                        conn.execute(
                            "UPDATE paper_variables SET variable_id = ? WHERE id = ?",
                            (target_variable_id, pv["id"]),
                        )

                conn.execute("UPDATE relationships SET source_variable_id = ? WHERE source_variable_id = ?", (target_variable_id, src_id))
                conn.execute("UPDATE relationships SET target_variable_id = ? WHERE target_variable_id = ?", (target_variable_id, src_id))
                conn.execute("UPDATE relationships SET mediator_variable_id = ? WHERE mediator_variable_id = ?", (target_variable_id, src_id))
                conn.execute("UPDATE relationships SET moderator_variable_id = ? WHERE moderator_variable_id = ?", (target_variable_id, src_id))
                conn.execute("UPDATE scales SET variable_id = ? WHERE variable_id = ?", (target_variable_id, src_id))
                conn.execute("DELETE FROM variables WHERE id = ?", (src_id,))

            conn.execute(
                "UPDATE variables SET aliases_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(aliases), now, target_variable_id),
            )
            updated = conn.execute("SELECT * FROM variables WHERE id = ?", (target_variable_id,)).fetchone()
        assert updated is not None
        return self._row_to_variable(updated)

    # --- Scale & Method Matrix (Tab 2) ---

    def query_scale_matrix(self, filters: ScaleMatrixFilter) -> ScaleMatrixResponse:
        where: list[str] = []
        params: list[Any] = []

        if filters.search and filters.search.strip():
            term = f"%{filters.search.strip()}%"
            where.append(
                "(s.name LIKE ? OR p.title LIKE ? OR COALESCE(v.display_label, '') LIKE ? OR COALESCE(s.original_authors, '') LIKE ?)"
            )
            params.extend([term, term, term, term])
        if filters.variable_id:
            where.append("s.variable_id = ?")
            params.append(filters.variable_id)
        if filters.min_alpha is not None:
            where.append("s.cronbach_alpha IS NOT NULL AND s.cronbach_alpha >= ?")
            params.append(filters.min_alpha)
        if filters.max_alpha is not None:
            where.append("s.cronbach_alpha IS NOT NULL AND s.cronbach_alpha <= ?")
            params.append(filters.max_alpha)
        if filters.min_sample_size is not None:
            where.append("COALESCE(s.sample_size_override, p.sample_size) >= ?")
            params.append(filters.min_sample_size)
        if filters.statistical_method and filters.statistical_method.strip():
            where.append("p.statistical_methods_json LIKE ?")
            params.append(f'%"{filters.statistical_method.strip()}"%')
        if filters.year_from is not None:
            where.append("p.year IS NOT NULL AND p.year >= ?")
            params.append(filters.year_from)
        if filters.year_to is not None:
            where.append("p.year IS NOT NULL AND p.year <= ?")
            params.append(filters.year_to)

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        sort_col = self._MATRIX_SORT_COLUMNS.get(filters.sort_by, "p.year")
        sort_dir = "ASC" if filters.sort_dir == "asc" else "DESC"

        base_from = """
            FROM scales s
            JOIN papers p ON p.id = s.paper_id
            LEFT JOIN variables v ON v.id = s.variable_id
        """

        with self.db.connect() as conn:
            total_row = conn.execute(f"SELECT COUNT(*) AS cnt {base_from} {where_sql}", params).fetchone()
            rows = conn.execute(
                f"""
                SELECT
                    s.id AS scale_id,
                    s.paper_id,
                    p.title AS paper_title,
                    p.authors_json,
                    p.year,
                    s.variable_id,
                    v.display_label AS variable_label,
                    s.name AS scale_name,
                    s.original_authors,
                    s.original_year,
                    s.item_count,
                    s.cronbach_alpha,
                    s.composite_reliability,
                    s.ave,
                    s.response_format,
                    COALESCE(s.sample_size_override, p.sample_size) AS sample_size,
                    p.sample_population,
                    p.statistical_methods_json,
                    p.research_design,
                    s.page_number
                {base_from}
                {where_sql}
                ORDER BY ({sort_col} IS NULL) ASC, {sort_col} {sort_dir}, s.name ASC
                LIMIT ? OFFSET ?
                """,
                [*params, filters.limit, filters.offset],
            ).fetchall()

        items = [
            ScaleMatrixRow(
                scale_id=r["scale_id"],
                paper_id=r["paper_id"],
                paper_title=r["paper_title"],
                authors=json.loads(r["authors_json"] or "[]"),
                year=r["year"],
                variable_id=r["variable_id"],
                variable_label=r["variable_label"],
                scale_name=r["scale_name"],
                original_authors=r["original_authors"],
                original_year=r["original_year"],
                item_count=r["item_count"],
                cronbach_alpha=r["cronbach_alpha"],
                composite_reliability=r["composite_reliability"],
                ave=r["ave"],
                response_format=r["response_format"],
                sample_size=r["sample_size"],
                sample_population=r["sample_population"],
                statistical_methods=json.loads(r["statistical_methods_json"] or "[]"),
                research_design=r["research_design"],
                page_number=r["page_number"],
            )
            for r in rows
        ]
        return ScaleMatrixResponse(
            items=items,
            total=int(total_row["cnt"]) if total_row else 0,
            limit=filters.limit,
            offset=filters.offset,
        )

    def list_statistical_methods(self) -> list[MethodCountItem]:
        counts: dict[str, int] = {}
        with self.db.connect() as conn:
            rows = conn.execute("SELECT statistical_methods_json FROM papers").fetchall()
        for r in rows:
            for method in json.loads(r["statistical_methods_json"] or "[]"):
                if isinstance(method, str) and method.strip():
                    key = method.strip()
                    counts[key] = counts.get(key, 0) + 1
        return [
            MethodCountItem(method=k, count=v)
            for k, v in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]

    # --- Graph, Gaps & Contradictions (Tab 1) ---

    def fetch_graph_snapshot(self) -> Any:
        from app.services.graph_service import GraphSnapshot

        with self.db.connect() as conn:
            var_rows = conn.execute("SELECT * FROM variables").fetchall()
            pv_rows = conn.execute(
                """
                SELECT pv.*, p.year
                FROM paper_variables pv
                JOIN papers p ON p.id = pv.paper_id
                """
            ).fetchall()
            rel_rows = conn.execute(
                """
                SELECT r.*, p.title AS paper_title, p.authors_json, p.year,
                       p.sample_size, p.statistical_methods_json
                FROM relationships r
                JOIN papers p ON p.id = r.paper_id
                """
            ).fetchall()

        return GraphSnapshot(
            variables=[dict(r) for r in var_rows],
            paper_variables=[dict(r) for r in pv_rows],
            relationships=[dict(r) for r in rel_rows],
        )

    def build_graph(
        self,
        *,
        min_paper_count: int = 1,
        direction: RelationshipDirection | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        variable_ids: list[str] | None = None,
    ) -> GraphResponse:
        from app.services.graph_service import GraphService

        return GraphService(self).build_graph(
            min_paper_count=min_paper_count,
            direction=direction,
            year_from=year_from,
            year_to=year_to,
            variable_ids=variable_ids,
        )

    def compute_research_gaps(self, *, limit: int = 20, min_gap_score: float = 0.0) -> list[ResearchGap]:
        from app.services.graph_service import GraphService

        return GraphService(self).compute_research_gaps(limit=limit, min_gap_score=min_gap_score)

    def compute_contradictions(self, edge_key: str | None = None) -> list[ContradictionCluster]:
        from app.services.graph_service import GraphService

        return GraphService(self).compute_contradictions(edge_key=edge_key)

    # --- Style Profiles, Drafts & Audit Findings ---

    def list_style_profiles(self) -> list[StyleProfile]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM style_profiles ORDER BY is_active DESC, created_at DESC").fetchall()
        return [self._row_to_style_profile(r) for r in rows]

    def create_style_profile(
        self,
        *,
        name: str,
        source_files: list[str],
        tone: str,
        avg_sentence_length: float,
        passive_voice_ratio: float,
        hedging_phrases: list[str],
        transition_phrases: list[str],
        citation_style: str,
        lexical_preferences: dict[str, Any],
        system_prompt_summary: str,
        is_active: bool,
    ) -> StyleProfile:
        profile_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self.db.connect() as conn:
            if is_active:
                conn.execute("UPDATE style_profiles SET is_active = 0")
            conn.execute(
                """
                INSERT INTO style_profiles (
                    id, name, source_files_json, tone, avg_sentence_length,
                    passive_voice_ratio, hedging_phrases_json, transition_phrases_json,
                    citation_style, lexical_preferences_json, system_prompt_summary,
                    is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile_id,
                    name,
                    json.dumps(source_files),
                    tone,
                    avg_sentence_length,
                    passive_voice_ratio,
                    json.dumps(hedging_phrases),
                    json.dumps(transition_phrases),
                    citation_style,
                    json.dumps(lexical_preferences),
                    system_prompt_summary,
                    1 if is_active else 0,
                    now,
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM style_profiles WHERE id = ?", (profile_id,)).fetchone()
        assert row is not None
        return self._row_to_style_profile(row)

    def list_drafts(self) -> list[Draft]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM drafts ORDER BY updated_at DESC").fetchall()
        return [self._row_to_draft(r) for r in rows]

    def create_draft(
        self,
        *,
        title: str,
        content_markdown: str = "",
        style_profile_id: str | None = None,
    ) -> Draft:
        draft_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self.db.connect() as conn:
            if style_profile_id:
                sp = conn.execute("SELECT id FROM style_profiles WHERE id = ?", (style_profile_id,)).fetchone()
                if sp is None:
                    raise NotFoundError(
                        error_code="STYLE_PROFILE_NOT_FOUND",
                        message="Belirtilen stil profili bulunamadı.",
                        details={"style_profile_id": style_profile_id},
                    )
            conn.execute(
                """
                INSERT INTO drafts (id, title, content_markdown, style_profile_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (draft_id, title, content_markdown, style_profile_id, now, now),
            )
            row = conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        assert row is not None
        return self._row_to_draft(row)

    def get_draft(self, draft_id: str) -> Draft:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            raise NotFoundError(error_code="DRAFT_NOT_FOUND", message="Taslak bulunamadı.", details={"draft_id": draft_id})
        return self._row_to_draft(row)

    def update_draft(
        self,
        draft_id: str,
        *,
        title: str | None = None,
        content_markdown: str | None = None,
        style_profile_id: str | None = None,
    ) -> Draft:
        fields: list[str] = ["updated_at = ?"]
        params: list[Any] = [utc_now_iso()]
        if title is not None:
            fields.append("title = ?")
            params.append(title)
        if content_markdown is not None:
            fields.append("content_markdown = ?")
            params.append(content_markdown)
        if style_profile_id is not None:
            fields.append("style_profile_id = ?")
            params.append(style_profile_id)
        params.append(draft_id)

        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if existing is None:
                raise NotFoundError(error_code="DRAFT_NOT_FOUND", message="Taslak bulunamadı.", details={"draft_id": draft_id})
            conn.execute(f"UPDATE drafts SET {', '.join(fields)} WHERE id = ?", params)
            row = conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        assert row is not None
        return self._row_to_draft(row)

    def delete_draft(self, draft_id: str) -> None:
        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if existing is None:
                raise NotFoundError(error_code="DRAFT_NOT_FOUND", message="Silinecek taslak bulunamadı.", details={"draft_id": draft_id})
            conn.execute("DELETE FROM drafts WHERE id = ?", (draft_id,))

    def dismiss_audit_finding(self, finding_id: str, is_dismissed: bool) -> AuditFinding:
        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM audit_findings WHERE id = ?", (finding_id,)).fetchone()
            if existing is None:
                raise NotFoundError(
                    error_code="AUDIT_FINDING_NOT_FOUND",
                    message="Denetim bulgusu bulunamadı.",
                    details={"finding_id": finding_id},
                )
            conn.execute(
                "UPDATE audit_findings SET is_dismissed = ? WHERE id = ?",
                (1 if is_dismissed else 0, finding_id),
            )
            row = conn.execute("SELECT * FROM audit_findings WHERE id = ?", (finding_id,)).fetchone()
        assert row is not None
        return self._row_to_audit_finding(row)

    def get_style_profile(self, profile_id: str) -> StyleProfile:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM style_profiles WHERE id = ?", (profile_id,)).fetchone()
        if row is None:
            raise NotFoundError(
                error_code="STYLE_PROFILE_NOT_FOUND",
                message="Stil profili bulunamadı.",
                details={"style_profile_id": profile_id},
            )
        return self._row_to_style_profile(row)

    def get_active_style_profile(self) -> StyleProfile | None:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM style_profiles WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
        return self._row_to_style_profile(row) if row else None

    def activate_style_profile(self, profile_id: str) -> StyleProfile:
        now = utc_now_iso()
        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM style_profiles WHERE id = ?", (profile_id,)).fetchone()
            if existing is None:
                raise NotFoundError(
                    error_code="STYLE_PROFILE_NOT_FOUND",
                    message="Stil profili bulunamadı.",
                    details={"style_profile_id": profile_id},
                )
            conn.execute("UPDATE style_profiles SET is_active = 0")
            conn.execute(
                "UPDATE style_profiles SET is_active = 1, updated_at = ? WHERE id = ?",
                (now, profile_id),
            )
            row = conn.execute("SELECT * FROM style_profiles WHERE id = ?", (profile_id,)).fetchone()
        assert row is not None
        return self._row_to_style_profile(row)

    def get_pool_fingerprint(self) -> str:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt, COALESCE(MAX(updated_at), '') AS latest FROM papers WHERE ingestion_status = 'completed'"
            ).fetchone()
        cnt = int(row["cnt"]) if row else 0
        latest = str(row["latest"]) if row else ""
        return f"{cnt}:{latest}"

    def fetch_critic_evidence_snapshot(self) -> Any:
        from app.services.critic_service import CriticEvidenceSnapshot

        with self.db.connect() as conn:
            papers = conn.execute(
                "SELECT * FROM papers WHERE ingestion_status = 'completed'"
            ).fetchall()
            variables = conn.execute("SELECT * FROM variables").fetchall()
            relationships = conn.execute(
                """
                SELECT r.* FROM relationships r
                JOIN papers p ON p.id = r.paper_id
                WHERE p.ingestion_status = 'completed'
                """
            ).fetchall()
            claims = conn.execute(
                """
                SELECT c.* FROM claims c
                JOIN papers p ON p.id = c.paper_id
                WHERE p.ingestion_status = 'completed'
                """
            ).fetchall()

        return CriticEvidenceSnapshot(
            papers_by_id={r["id"]: dict(r) for r in papers},
            variables=[dict(r) for r in variables],
            relationships=[dict(r) for r in relationships],
            claims=[dict(r) for r in claims],
        )

    def _hydrate_audit_result(self, conn: sqlite3.Connection, row: sqlite3.Row) -> AuditResult:
        finding_rows = conn.execute(
            "SELECT * FROM audit_findings WHERE audit_result_id = ? ORDER BY created_at ASC",
            (row["id"],),
        ).fetchall()
        return AuditResult(
            id=row["id"],
            draft_id=row["draft_id"],
            paragraph_index=row["paragraph_index"],
            paragraph_hash=row["paragraph_hash"],
            paragraph_text=row["paragraph_text"],
            overall_status=AuditOverallStatus(row["overall_status"]),
            style_alignment_score=row["style_alignment_score"],
            evidence_coverage_score=row["evidence_coverage_score"],
            summary=row["summary"],
            model_used=row["model_used"],
            findings=[self._row_to_audit_finding(fr) for fr in finding_rows],
            created_at=row["created_at"],
        )

    def get_cached_audit_result(self, draft_id: str, paragraph_hash: str) -> AuditResult | None:
        with self.db.connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM audit_results
                WHERE draft_id = ? AND paragraph_hash = ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (draft_id, paragraph_hash),
            ).fetchone()
            if row is None:
                return None
            return self._hydrate_audit_result(conn, row)

    def save_audit_result(self, result: AuditResult) -> AuditResult:
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_results (
                    id, draft_id, paragraph_index, paragraph_hash, paragraph_text,
                    overall_status, style_alignment_score, evidence_coverage_score,
                    summary, model_used, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.id,
                    result.draft_id,
                    result.paragraph_index,
                    result.paragraph_hash,
                    result.paragraph_text,
                    result.overall_status.value,
                    result.style_alignment_score,
                    result.evidence_coverage_score,
                    result.summary,
                    result.model_used,
                    result.created_at,
                ),
            )
            for f in result.findings:
                conn.execute(
                    """
                    INSERT INTO audit_findings (
                        id, audit_result_id, finding_type, severity, excerpt, explanation,
                        suggestion, related_paper_id, related_claim_id, related_relationship_id,
                        page_number, quote_snippet, is_dismissed, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f.id,
                        result.id,
                        f.finding_type.value,
                        f.severity.value,
                        f.excerpt,
                        f.explanation,
                        f.suggestion,
                        f.related_paper_id,
                        f.related_claim_id,
                        f.related_relationship_id,
                        f.page_number,
                        f.quote_snippet,
                        1 if f.is_dismissed else 0,
                        f.created_at,
                    ),
                )
        return result

    def list_draft_audits(self, draft_id: str) -> list[AuditResult]:
        with self.db.connect() as conn:
            existing = conn.execute("SELECT id FROM drafts WHERE id = ?", (draft_id,)).fetchone()
            if existing is None:
                raise NotFoundError(error_code="DRAFT_NOT_FOUND", message="Taslak bulunamadı.", details={"draft_id": draft_id})
            rows = conn.execute(
                """
                SELECT * FROM audit_results
                WHERE draft_id = ?
                ORDER BY paragraph_index ASC, created_at DESC
                """,
                (draft_id,),
            ).fetchall()
            seen_indices: set[int] = set()
            latest_results: list[AuditResult] = []
            for row in rows:
                idx = int(row["paragraph_index"])
                if idx in seen_indices:
                    continue
                seen_indices.add(idx)
                latest_results.append(self._hydrate_audit_result(conn, row))
        return latest_results
