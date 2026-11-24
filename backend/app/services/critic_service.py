from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

from app.db.sqlite import ResearchRepository, utc_now_iso
from app.db.vector_store import EmbeddingProvider, VectorStore
from app.models.schemas import (
    AuditFinding,
    AuditFindingType,
    AuditOverallStatus,
    AuditParagraphRequest,
    AuditResult,
    RelationshipDirection,
    Severity,
    StyleProfile,
)
from app.pipeline.normalizer import normalize_variable_key

POSITIVE_MARKERS = (
    "increase",
    "increases",
    "increased",
    "positively",
    "positive",
    "boost",
    "boosts",
    "boosted",
    "elevate",
    "elevated",
    "enhance",
    "enhances",
    "enhanced",
    "improve",
    "improves",
    "improved",
    "higher",
    "artır",
    "arttır",
    "pozitif",
    "olumlu",
    "yükselt",
    "güçlendir",
)
NEGATIVE_MARKERS = (
    "decrease",
    "decreases",
    "decreased",
    "negatively",
    "negative",
    "reduce",
    "reduces",
    "reduced",
    "lower",
    "lowers",
    "lowered",
    "harm",
    "harms",
    "inhibit",
    "diminish",
    "azalt",
    "negatif",
    "olumsuz",
    "düşür",
    "zayıflat",
)
INSIGNIFICANT_MARKERS = (
    "no significant",
    "not significant",
    "insignificant",
    "no effect",
    "unrelated",
    "anlamlı değil",
    "anlamsız",
    "etkisi yok",
    "ilişkisiz",
)

EMPIRICAL_ASSERTION_MARKERS = (
    *POSITIVE_MARKERS,
    *NEGATIVE_MARKERS,
    *INSIGNIFICANT_MARKERS,
    "predict",
    "predicts",
    "predicted",
    "associate",
    "associated",
    "correlate",
    "correlated",
    "cause",
    "causes",
    "caused",
    "mediate",
    "mediates",
    "moderate",
    "moderates",
    "show",
    "shows",
    "found",
    "demonstrate",
    "etkile",
    "yordar",
    "yordamaktadır",
    "ilişkili",
    "bulunmuştur",
    "göstermektedir",
    "kanıtla",
)

ABSOLUTIST_MARKERS = (
    "always",
    "never",
    "definitely",
    "undoubtedly",
    "proves",
    "proven",
    "100%",
    "kesinlikle",
    "şüphesiz",
    "her zaman",
    "asla",
    "kanıtlamaktadır",
)

CITATION_INLINE_RE = re.compile(
    r"\([A-ZÇĞİÖŞÜ][^()]*\d{4}[^()]*\)|\[\d+(?:\s*[-–,]\s*\d+)*\]"
)

STOPWORDS = {
    "the",
    "and",
    "for",
    "that",
    "with",
    "from",
    "this",
    "these",
    "those",
    "have",
    "has",
    "are",
    "was",
    "were",
    "been",
    "into",
    "across",
    "between",
    "study",
    "studies",
    "paper",
    "ve",
    "ile",
    "için",
    "olan",
    "olarak",
    "üzerinde",
    "arasında",
    "bir",
    "bu",
}


@dataclass(slots=True)
class CriticEvidenceSnapshot:
    papers_by_id: dict[str, dict[str, Any]]
    variables: list[dict[str, Any]]
    relationships: list[dict[str, Any]]
    claims: list[dict[str, Any]]


def _tokenize_content(text: str) -> set[str]:
    tokens = set(re.findall(r"[a-zçğıöşü0-9]{3,}", text.lower()))
    return {t for t in tokens if t not in STOPWORDS}


def _detect_direction(sentence_lower: str) -> RelationshipDirection | None:
    if any(m in sentence_lower for m in INSIGNIFICANT_MARKERS):
        return RelationshipDirection.INSIGNIFICANT
    has_pos = any(re.search(rf"\b{re.escape(m)}", sentence_lower) for m in POSITIVE_MARKERS)
    has_neg = any(re.search(rf"\b{re.escape(m)}", sentence_lower) for m in NEGATIVE_MARKERS)
    if has_pos and not has_neg:
        return RelationshipDirection.POSITIVE
    if has_neg and not has_pos:
        return RelationshipDirection.NEGATIVE
    if has_pos and has_neg:
        return RelationshipDirection.MIXED
    return None


def _is_empirical_sentence(sentence_lower: str) -> bool:
    return any(m in sentence_lower for m in EMPIRICAL_ASSERTION_MARKERS)


def _directions_oppose(claimed: RelationshipDirection, observed: RelationshipDirection) -> bool:
    if claimed == RelationshipDirection.POSITIVE and observed in (
        RelationshipDirection.NEGATIVE,
        RelationshipDirection.INSIGNIFICANT,
    ):
        return True
    if claimed == RelationshipDirection.NEGATIVE and observed in (
        RelationshipDirection.POSITIVE,
        RelationshipDirection.INSIGNIFICANT,
    ):
        return True
    if claimed == RelationshipDirection.INSIGNIFICANT and observed in (
        RelationshipDirection.POSITIVE,
        RelationshipDirection.NEGATIVE,
    ):
        return True
    return False


def _format_citation_suggestion(paper: dict[str, Any], page_number: int | None) -> str:
    authors = json.loads(paper.get("authors_json") or "[]")
    first_author = authors[0].split()[-1] if authors and isinstance(authors[0], str) and authors[0].strip() else paper["title"][:24]
    year = paper.get("year") or "t.y."
    page_part = f", s. {page_number}" if page_number else ""
    return f"Önerilen atıf: ({first_author}, {year}{page_part})"


class CriticService:
    """Cross-checks draft paragraphs against SQLite evidence, LanceDB chunks, and active style."""

    def __init__(
        self,
        repo: ResearchRepository,
        vector_store: VectorStore,
        embedder: EmbeddingProvider,
    ) -> None:
        self.repo = repo
        self.vector_store = vector_store
        self.embedder = embedder

    def audit_paragraph(self, draft_id: str, req: AuditParagraphRequest) -> AuditResult:
        draft = self.repo.get_draft(draft_id)
        style_profile = self._resolve_style_profile(req.style_profile_id or draft.style_profile_id)
        pool_fp = self.repo.get_pool_fingerprint()

        normalized_text = req.paragraph_text.strip()
        cache_key_raw = f"{normalized_text}|{style_profile.id if style_profile else 'none'}|{pool_fp}"
        paragraph_hash = hashlib.sha256(cache_key_raw.encode("utf-8")).hexdigest()

        if not req.force_refresh:
            cached = self.repo.get_cached_audit_result(draft_id, paragraph_hash)
            if cached is not None:
                return cached

        snapshot = self.repo.fetch_critic_evidence_snapshot()
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", normalized_text) if s.strip()]
        if not sentences:
            sentences = [normalized_text]

        audit_result_id = str(uuid.uuid4())
        now = utc_now_iso()
        findings: list[AuditFinding] = []

        # Değişken eşleştirme kalıplarını hazırla
        var_patterns: list[tuple[str, str, list[str]]] = []
        for var in snapshot.variables:
            aliases = json.loads(var.get("aliases_json") or "[]")
            terms = [var["canonical_name"], var["display_label"], *aliases]
            cleaned_terms = sorted({t.strip() for t in terms if isinstance(t, str) and len(t.strip()) >= 2}, key=len, reverse=True)
            var_patterns.append((var["id"], var["display_label"], cleaned_terms))

        empirical_sentences = 0
        supported_sentences = 0
        contradicted_sentences = 0
        has_inline_citation = bool(CITATION_INLINE_RE.search(normalized_text))

        for sentence in sentences:
            sent_lower = sentence.lower()
            sent_norm = normalize_variable_key(sentence)
            matched_var_ids: list[str] = []
            for vid, _label, terms in var_patterns:
                for term in terms:
                    t_norm = normalize_variable_key(term)
                    if t_norm and re.search(rf"\b{re.escape(t_norm)}\b", sent_norm):
                        matched_var_ids.append(vid)
                        break

            claimed_dir = _detect_direction(sent_lower)
            is_empirical = _is_empirical_sentence(sent_lower) or claimed_dir is not None or len(matched_var_ids) >= 2
            if not is_empirical:
                continue

            empirical_sentences += 1
            sent_has_support = False
            sent_has_contradiction = False
            matched_var_set = set(matched_var_ids)

            # 1. SQLite Relationships Çapraz Kontrolü
            if len(matched_var_set) >= 2:
                matching_rels = [
                    r
                    for r in snapshot.relationships
                    if r["source_variable_id"] in matched_var_set
                    and r["target_variable_id"] in matched_var_set
                    and r["source_variable_id"] != r["target_variable_id"]
                ]
                for rel in matching_rels:
                    obs_dir = RelationshipDirection(rel["direction"])
                    paper = snapshot.papers_by_id.get(rel["paper_id"])
                    paper_title = paper["title"] if paper else "Bilinmeyen Makale"

                    if claimed_dir is not None and _directions_oppose(claimed_dir, obs_dir):
                        sent_has_contradiction = True
                        findings.append(
                            AuditFinding(
                                id=str(uuid.uuid4()),
                                audit_result_id=audit_result_id,
                                finding_type=AuditFindingType.CONTRADICTION,
                                severity=Severity.ERROR,
                                excerpt=sentence,
                                explanation=(
                                    f"Cümledeki '{claimed_dir.value}' yönlü iddia, '{paper_title}' makalesindeki "
                                    f"'{obs_dir.value}' bulgusuyla (s. {rel['page_number']}) çelişmektedir."
                                ),
                                suggestion=(
                                    "Bu çelişkiyi literatürdeki ayrışma olarak açıkça belirtin veya örneklem/yöntem farkına atıf yapın."
                                ),
                                related_paper_id=rel["paper_id"],
                                related_claim_id=None,
                                related_relationship_id=rel["id"],
                                page_number=rel["page_number"],
                                quote_snippet=rel["quote_snippet"],
                                is_dismissed=False,
                                created_at=now,
                            )
                        )
                    else:
                        sent_has_support = True
                        findings.append(
                            AuditFinding(
                                id=str(uuid.uuid4()),
                                audit_result_id=audit_result_id,
                                finding_type=AuditFindingType.SUPPORTING_EVIDENCE,
                                severity=Severity.INFO,
                                excerpt=sentence,
                                explanation=(
                                    f"'{paper_title}' makalesi (s. {rel['page_number']}) bu ilişkiyi "
                                    f"'{obs_dir.value}' yönünde desteklemektedir."
                                ),
                                suggestion=_format_citation_suggestion(paper, rel["page_number"]) if paper else None,
                                related_paper_id=rel["paper_id"],
                                related_claim_id=None,
                                related_relationship_id=rel["id"],
                                page_number=rel["page_number"],
                                quote_snippet=rel["quote_snippet"],
                                is_dismissed=False,
                                created_at=now,
                            )
                        )
                        if not has_inline_citation and paper:
                            findings.append(
                                AuditFinding(
                                    id=str(uuid.uuid4()),
                                    audit_result_id=audit_result_id,
                                    finding_type=AuditFindingType.MISSING_CITATION,
                                    severity=Severity.WARNING,
                                    excerpt=sentence,
                                    explanation=(
                                        f"İddia yerel havuzdaki '{paper_title}' (s. {rel['page_number']}) ile destekleniyor "
                                        "ancak cümlede satır içi atıf bulunamadı."
                                    ),
                                    suggestion=_format_citation_suggestion(paper, rel["page_number"]),
                                    related_paper_id=rel["paper_id"],
                                    related_claim_id=None,
                                    related_relationship_id=rel["id"],
                                    page_number=rel["page_number"],
                                    quote_snippet=rel["quote_snippet"],
                                    is_dismissed=False,
                                    created_at=now,
                                )
                            )

            # 2. İlişki eşleşmesi yoksa SQLite Claims + LanceDB hibrit kontrolü
            if not sent_has_support and not sent_has_contradiction:
                sent_tokens = _tokenize_content(sentence)
                best_claim: dict[str, Any] | None = None
                best_overlap = 0.0
                for claim in snapshot.claims:
                    c_tokens = _tokenize_content(claim["claim_text"])
                    if not sent_tokens or not c_tokens:
                        continue
                    overlap = len(sent_tokens & c_tokens) / max(1, min(len(sent_tokens), len(c_tokens)))
                    if overlap >= 0.45 and len(sent_tokens & c_tokens) >= 2 and overlap > best_overlap:
                        best_overlap = overlap
                        best_claim = claim

                if best_claim is not None:
                    paper = snapshot.papers_by_id.get(best_claim["paper_id"])
                    paper_title = paper["title"] if paper else "Bilinmeyen Makale"
                    sent_has_support = True
                    findings.append(
                        AuditFinding(
                            id=str(uuid.uuid4()),
                            audit_result_id=audit_result_id,
                            finding_type=AuditFindingType.SUPPORTING_EVIDENCE,
                            severity=Severity.INFO,
                            excerpt=sentence,
                            explanation=(
                                f"'{paper_title}' makalesindeki ana iddia (s. {best_claim['page_number']}) ile anlamca örtüşmektedir."
                            ),
                            suggestion=_format_citation_suggestion(paper, best_claim["page_number"]) if paper else None,
                            related_paper_id=best_claim["paper_id"],
                            related_claim_id=best_claim["id"],
                            related_relationship_id=None,
                            page_number=best_claim["page_number"],
                            quote_snippet=best_claim["quote_snippet"] or best_claim["claim_text"],
                            is_dismissed=False,
                            created_at=now,
                        )
                    )
                    if not has_inline_citation and paper:
                        findings.append(
                            AuditFinding(
                                id=str(uuid.uuid4()),
                                audit_result_id=audit_result_id,
                                finding_type=AuditFindingType.MISSING_CITATION,
                                severity=Severity.WARNING,
                                excerpt=sentence,
                                explanation=(
                                    f"Cümle '{paper_title}' (s. {best_claim['page_number']}) iddiasıyla örtüşüyor ancak atıf eksik."
                                ),
                                suggestion=_format_citation_suggestion(paper, best_claim["page_number"]),
                                related_paper_id=best_claim["paper_id"],
                                related_claim_id=best_claim["id"],
                                related_relationship_id=None,
                                page_number=best_claim["page_number"],
                                quote_snippet=best_claim["quote_snippet"] or best_claim["claim_text"],
                                is_dismissed=False,
                                created_at=now,
                            )
                        )
                elif snapshot.papers_by_id:
                    # LanceDB chunk araması — sadece gerçek yüksek token örtüşmesi varsa kabul et
                    vec_hits = self._search_verified_chunks(sentence, sent_tokens, snapshot.papers_by_id)
                    if vec_hits:
                        top_hit = vec_hits[0]
                        paper = snapshot.papers_by_id[top_hit["paper_id"]]
                        sent_has_support = True
                        findings.append(
                            AuditFinding(
                                id=str(uuid.uuid4()),
                                audit_result_id=audit_result_id,
                                finding_type=AuditFindingType.SUPPORTING_EVIDENCE,
                                severity=Severity.INFO,
                                excerpt=sentence,
                                explanation=(
                                    f"'{paper['title']}' makalesinin {top_hit['page_number']}. sayfasındaki pasajla desteklenmektedir."
                                ),
                                suggestion=_format_citation_suggestion(paper, int(top_hit["page_number"])),
                                related_paper_id=str(top_hit["paper_id"]),
                                related_claim_id=None,
                                related_relationship_id=None,
                                page_number=int(top_hit["page_number"]),
                                quote_snippet=str(top_hit["text"])[:240],
                                is_dismissed=False,
                                created_at=now,
                            )
                        )

            if sent_has_contradiction:
                contradicted_sentences += 1
            elif sent_has_support:
                supported_sentences += 1
            else:
                # Havuzda destekleyici kayıt yoksa ASLA uydurma kaynak/sayfa üretme
                findings.append(
                    AuditFinding(
                        id=str(uuid.uuid4()),
                        audit_result_id=audit_result_id,
                        finding_type=AuditFindingType.UNSUPPORTED_CLAIM,
                        severity=Severity.WARNING,
                        excerpt=sentence,
                        explanation=(
                            "Bu ampirik iddia yerel makale havuzundaki doğrulanmış ilişkiler veya iddialar arasında desteklenemedi."
                        ),
                        suggestion=(
                            "İlgili makaleyi PDF havuzuna ekleyin, ifadenin kesinliğini yumuşatın veya doğrudan kaynak atfı belirtin."
                        ),
                        related_paper_id=None,
                        related_claim_id=None,
                        related_relationship_id=None,
                        page_number=None,
                        quote_snippet=None,
                        is_dismissed=False,
                        created_at=now,
                    )
                )

        # 3. Stil Profili Uyumu Denetimi
        style_score, style_findings = self._evaluate_style(
            sentences=sentences,
            style_profile=style_profile,
            audit_result_id=audit_result_id,
            now=now,
        )
        findings.extend(style_findings)

        if empirical_sentences == 0:
            evidence_score = 1.0
        else:
            evidence_score = round(supported_sentences / empirical_sentences, 3)

        if contradicted_sentences > 0:
            overall_status = AuditOverallStatus.CONTRADICTED
        elif empirical_sentences > 0 and supported_sentences == 0:
            overall_status = AuditOverallStatus.UNSUPPORTED
        elif any(f.finding_type in (AuditFindingType.UNSUPPORTED_CLAIM, AuditFindingType.MISSING_CITATION, AuditFindingType.STYLE_DEVIATION) for f in findings):
            overall_status = AuditOverallStatus.WARNING
        else:
            overall_status = AuditOverallStatus.SUPPORTED

        summary = (
            f"{empirical_sentences} ampirik cümleden {supported_sentences} desteklendi, "
            f"{contradicted_sentences} çelişki ve {sum(1 for f in findings if f.finding_type == AuditFindingType.UNSUPPORTED_CLAIM)} desteksiz iddia saptandı."
        )

        result = AuditResult(
            id=audit_result_id,
            draft_id=draft_id,
            paragraph_index=req.paragraph_index,
            paragraph_hash=paragraph_hash,
            paragraph_text=normalized_text,
            overall_status=overall_status,
            style_alignment_score=style_score,
            evidence_coverage_score=evidence_score,
            summary=summary,
            model_used="hybrid-sqlite-lancedb-critic",
            findings=findings,
            created_at=now,
        )
        return self.repo.save_audit_result(result)

    def _resolve_style_profile(self, style_profile_id: str | None) -> StyleProfile | None:
        if style_profile_id:
            return self.repo.get_style_profile(style_profile_id)
        return self.repo.get_active_style_profile()

    def _search_verified_chunks(
        self,
        sentence: str,
        sent_tokens: set[str],
        papers_by_id: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not sent_tokens:
            return []
        try:
            query_vec = self.embedder.embed_texts([sentence])[0]
            raw_hits = self.vector_store.search_paper_chunks(query_vec, limit=5)
        except Exception:
            return []

        verified: list[dict[str, Any]] = []
        for hit in raw_hits:
            pid = str(hit.get("paper_id") or "")
            if pid not in papers_by_id:
                continue
            chunk_tokens = _tokenize_content(str(hit.get("text") or ""))
            overlap_tokens = sent_tokens & chunk_tokens
            ratio = len(overlap_tokens) / max(1, len(sent_tokens))
            if len(overlap_tokens) >= 3 and ratio >= 0.45:
                verified.append(hit)
        return verified

    @staticmethod
    def _evaluate_style(
        *,
        sentences: list[str],
        style_profile: StyleProfile | None,
        audit_result_id: str,
        now: str,
    ) -> tuple[float, list[AuditFinding]]:
        findings: list[AuditFinding] = []
        penalty = 0.0

        word_counts = [len(re.findall(r"\b\w+\b", s)) for s in sentences]
        para_avg_len = sum(word_counts) / max(1, len(sentences))

        for s in sentences:
            s_lower = s.lower()
            hit_abs = next((m for m in ABSOLUTIST_MARKERS if re.search(rf"\b{re.escape(m)}\b", s_lower)), None)
            if hit_abs:
                penalty += 0.2
                findings.append(
                    AuditFinding(
                        id=str(uuid.uuid4()),
                        audit_result_id=audit_result_id,
                        finding_type=AuditFindingType.STYLE_DEVIATION,
                        severity=Severity.WARNING,
                        excerpt=s,
                        explanation=f"'{hit_abs}' gibi kesinlik bildiren ifade akademik ihtiyatlılık (hedging) normundan sapıyor.",
                        suggestion=(
                            f"Hedging ifadesi kullanın (ör. {', '.join(style_profile.hedging_phrases[:3])})."
                            if style_profile and style_profile.hedging_phrases
                            else "'may', 'indicates' veya 'göstermektedir' gibi ihtiyatlı ifadeler tercih edin."
                        ),
                        related_paper_id=None,
                        related_claim_id=None,
                        related_relationship_id=None,
                        page_number=None,
                        quote_snippet=None,
                        is_dismissed=False,
                        created_at=now,
                    )
                )

        if style_profile and style_profile.avg_sentence_length > 0:
            diff_ratio = abs(para_avg_len - style_profile.avg_sentence_length) / max(8.0, style_profile.avg_sentence_length)
            if diff_ratio > 0.55:
                penalty += 0.15
                findings.append(
                    AuditFinding(
                        id=str(uuid.uuid4()),
                        audit_result_id=audit_result_id,
                        finding_type=AuditFindingType.STYLE_DEVIATION,
                        severity=Severity.INFO,
                        excerpt=sentences[0],
                        explanation=(
                            f"Paragraf ortalama cümle uzunluğu ({para_avg_len:.1f} kelime), aktif '{style_profile.name}' "
                            f"profilinizdeki ortalamadan ({style_profile.avg_sentence_length:.1f} kelime) belirgin biçimde sapıyor."
                        ),
                        suggestion="Cümle ritmini profilinizdeki ortalama uzunluğa yaklaştırmayı değerlendirin.",
                        related_paper_id=None,
                        related_claim_id=None,
                        related_relationship_id=None,
                        page_number=None,
                        quote_snippet=None,
                        is_dismissed=False,
                        created_at=now,
                    )
                )

        score = round(max(0.0, min(1.0, 1.0 - penalty)), 3)
        return score, findings
