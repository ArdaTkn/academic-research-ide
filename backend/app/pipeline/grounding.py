from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.models.schemas import GroundingStatus, PaperExtractionPayload
from app.pipeline.pdf_extractor import ExtractedDocument


_WS_RE = re.compile(r"\s+")
_WORD_RE = re.compile(r"[a-z0-9α-ω]+")


def normalize_for_matching(text: str | None) -> str:
    """Normalize PDF/quote text (ligatures, smart quotes, dashes, whitespace)."""
    if not text:
        return ""
    cleaned = (
        text.replace("\u00ad", "")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
        .replace("fi", "fi")
    )
    cleaned = _WS_RE.sub(" ", cleaned).strip().lower()
    return cleaned.strip(" \"'`.,;:")


def _tokenize(text: str) -> list[str]:
    return [tok for tok in _WORD_RE.findall(text.lower()) if len(tok) >= 2]


def _best_window_similarity(query: str, page_text: str) -> float:
    """Compute best sliding-window similarity ratio for a query against normalized page text."""
    if not query or not page_text:
        return 0.0
    if query in page_text:
        return 1.0

    q_words = query.split()
    p_words = page_text.split()
    if not q_words or not p_words:
        return 0.0

    if len(p_words) <= len(q_words) + 4:
        return SequenceMatcher(None, query, page_text).ratio()

    win_len = max(len(q_words), 1)
    best = 0.0
    step = 1 if len(p_words) < 400 else 2
    for idx in range(0, max(1, len(p_words) - win_len + 1), step):
        candidate = " ".join(p_words[idx : idx + win_len + 2])
        ratio = SequenceMatcher(None, query, candidate).ratio()
        if ratio > best:
            best = ratio
            if best >= 0.96:
                return best

    # Blend with token overlap to handle minor OCR line-break or symbol splits
    q_tok = set(_tokenize(query))
    p_tok = set(_tokenize(page_text))
    if q_tok:
        token_overlap = len(q_tok & p_tok) / len(q_tok)
        return max(best, token_overlap * 0.85 if token_overlap >= 0.6 else token_overlap * 0.65)
    return best


@dataclass(slots=True)
class GroundingVerdict:
    status: GroundingStatus
    score: float
    note: str


@dataclass(slots=True)
class PayloadGrounding:
    claims: list[GroundingVerdict]
    relationships: list[GroundingVerdict]
    scales: list[GroundingVerdict]


def verify_quote_on_page(
    *,
    page_number: int,
    quote_snippet: str | None,
    fallback_anchors: list[str],
    pages_by_num: dict[int, str],
    allow_anchor_verified: bool = False,
) -> GroundingVerdict:
    """Verify whether an extracted quote/scale/anchor exists on the cited PDF page."""
    raw_page = pages_by_num.get(page_number)
    if raw_page is None or not raw_page.strip():
        return GroundingVerdict(
            status=GroundingStatus.UNVERIFIED,
            score=0.0,
            note="page_out_of_range",
        )

    norm_page = normalize_for_matching(raw_page)
    norm_quote = normalize_for_matching(quote_snippet)

    if norm_quote:
        if norm_quote in norm_page:
            return GroundingVerdict(
                status=GroundingStatus.VERIFIED,
                score=1.0,
                note="exact_quote_match",
            )

        sim = _best_window_similarity(norm_quote, norm_page)
        if sim >= 0.80:
            return GroundingVerdict(
                status=GroundingStatus.VERIFIED,
                score=round(sim, 3),
                note="high_similarity_quote_match",
            )
        if sim >= 0.45:
            return GroundingVerdict(
                status=GroundingStatus.PARTIAL,
                score=round(sim, 3),
                note="partial_quote_match",
            )

        # Check if the quote actually appears on a different page in the same PDF
        for other_page, other_text in pages_by_num.items():
            if other_page == page_number:
                continue
            other_norm = normalize_for_matching(other_text)
            if norm_quote in other_norm or _best_window_similarity(norm_quote, other_norm) >= 0.80:
                return GroundingVerdict(
                    status=GroundingStatus.PARTIAL,
                    score=round(max(0.35, sim), 3),
                    note=f"quote_found_on_other_page:{other_page}",
                )

        return GroundingVerdict(
            status=GroundingStatus.UNVERIFIED,
            score=round(sim, 3),
            note="quote_not_found_on_page",
        )

    # No quote_snippet provided — check anchor terms (e.g., scale name or claim keywords)
    anchor_text = " ".join(a for a in fallback_anchors if a).strip()
    norm_anchor = normalize_for_matching(anchor_text)
    anchor_tokens = set(_tokenize(norm_anchor))
    page_tokens = set(_tokenize(norm_page))
    overlap = (len(anchor_tokens & page_tokens) / len(anchor_tokens)) if anchor_tokens else 0.0

    if allow_anchor_verified:
        if norm_anchor and norm_anchor in norm_page:
            return GroundingVerdict(
                status=GroundingStatus.VERIFIED,
                score=0.9,
                note="scale_name_matched_on_page",
            )
        if overlap >= 0.45:
            return GroundingVerdict(
                status=GroundingStatus.PARTIAL,
                score=round(min(0.75, overlap), 3),
                note="partial_scale_match",
            )
        return GroundingVerdict(
            status=GroundingStatus.UNVERIFIED,
            score=round(overlap * 0.5, 3),
            note="scale_not_found_on_page",
        )

    if overlap >= 0.55:
        return GroundingVerdict(
            status=GroundingStatus.PARTIAL,
            score=round(min(0.70, overlap * 0.75), 3),
            note="no_quote_anchor_matched",
        )
    return GroundingVerdict(
        status=GroundingStatus.UNVERIFIED,
        score=round(overlap * 0.4, 3),
        note="missing_quote_snippet",
    )


def ground_extraction_payload(
    payload: PaperExtractionPayload,
    doc: ExtractedDocument,
) -> PayloadGrounding:
    """Compute grounding verdicts for every Claim, Relationship, and Scale in a payload."""
    pages_by_num = {page.page_number: page.text for page in doc.pages}

    claim_verdicts = [
        verify_quote_on_page(
            page_number=claim.page_number,
            quote_snippet=claim.quote_snippet,
            fallback_anchors=[claim.claim_text],
            pages_by_num=pages_by_num,
            allow_anchor_verified=False,
        )
        for claim in payload.claims
    ]

    rel_verdicts = [
        verify_quote_on_page(
            page_number=rel.page_number,
            quote_snippet=rel.quote_snippet,
            fallback_anchors=[rel.source_variable, rel.target_variable, rel.statistical_method or ""],
            pages_by_num=pages_by_num,
            allow_anchor_verified=False,
        )
        for rel in payload.relationships
    ]

    scale_verdicts = [
        verify_quote_on_page(
            page_number=scale.page_number,
            quote_snippet=scale.quote_snippet,
            fallback_anchors=[scale.name],
            pages_by_num=pages_by_num,
            allow_anchor_verified=True,
        )
        for scale in payload.scales
    ]

    return PayloadGrounding(
        claims=claim_verdicts,
        relationships=rel_verdicts,
        scales=scale_verdicts,
    )
