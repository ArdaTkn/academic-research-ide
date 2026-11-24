from __future__ import annotations

import re
import uuid
from pathlib import Path

from app.core.errors import BadRequestError, NotFoundError
from app.core.i18n import Locale, resolve_locale, t
from app.db.sqlite import ResearchRepository
from app.db.vector_store import EmbeddingProvider, VectorStore
from app.models.schemas import StyleExtractRequest, StyleProfile
from app.pipeline.pdf_extractor import extract_pdf

HEDGING_LEXICON = (
    "may",
    "might",
    "could",
    "suggests",
    "indicates",
    "appears",
    "potentially",
    "likely",
    "tends to",
    "in part",
    "olabilir",
    "göstermektedir",
    "işaret etmektedir",
    "olasıdır",
    "eğilimindedir",
    "kısmen",
)

TRANSITION_LEXICON = (
    "however",
    "moreover",
    "furthermore",
    "consequently",
    "in contrast",
    "nevertheless",
    "therefore",
    "additionally",
    "bununla birlikte",
    "ancak",
    "ayrıca",
    "sonuç olarak",
    "öte yandan",
    "dolayısıyla",
)

PASSIVE_RE = re.compile(
    r"\b(?:is|are|was|were|been|being|be)\s+\w+(?:ed|en)\b"
    r"|\b\w+(?:ıl|il|ul|ül|ın|in|un|ün)(?:dı|di|du|dü|maktadır|mektedir|mıştır|miştir)\b",
    re.IGNORECASE,
)
APA_CITE_RE = re.compile(r"\([A-ZÇĞİÖŞÜ][^()]*,\s*(?:19|20)\d{2}[a-z]?\)")
IEEE_CITE_RE = re.compile(r"\[\d+(?:\s*[-–,]\s*\d+)*\]")
FIRST_PERSON_RE = re.compile(r"\b(?:i|we|our|us|ben|biz|bizim)\b", re.IGNORECASE)


class StyleService:
    """Extracts measurable academic writing style profiles and indexes style chunks."""

    def __init__(
        self,
        repo: ResearchRepository,
        vector_store: VectorStore,
        embedder: EmbeddingProvider,
    ) -> None:
        self.repo = repo
        self.vector_store = vector_store
        self.embedder = embedder

    def extract_style_profile(self, req: StyleExtractRequest, *, locale: Locale = "en") -> StyleProfile:
        active_locale = resolve_locale(explicit=req.locale, default=locale)
        texts: list[tuple[str, str]] = []
        for raw in req.raw_texts:
            cleaned = raw.strip()
            if cleaned:
                texts.append(("inline_text", cleaned))

        for path_str in req.file_paths:
            path = Path(path_str)
            if not path.exists() or not path.is_file():
                raise NotFoundError(
                    error_code="STYLE_SOURCE_NOT_FOUND",
                    message="Stil çıkarımı için belirtilen dosya bulunamadı.",
                    details={"file_path": path_str},
                )
            if path.suffix.lower() == ".pdf":
                doc = extract_pdf(path)
                joined = "\n\n".join(p.text for p in doc.pages if p.text.strip())
                if joined.strip():
                    texts.append((path.name, joined.strip()))
            else:
                content = path.read_text(encoding="utf-8", errors="replace").strip()
                if content:
                    texts.append((path.name, content))

        if not texts:
            raise BadRequestError(
                error_code="NO_STYLE_TEXTS_PROVIDED",
                message="Stil profili çıkarmak için en az bir boş olmayan metin veya dosya sağlanmalıdır.",
            )

        combined = "\n\n".join(t for _, t in texts)
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", combined) if len(s.strip().split()) >= 2]
        if not sentences:
            sentences = [combined]

        word_counts = [len(re.findall(r"\b\w+\b", s)) for s in sentences]
        avg_len = round(sum(word_counts) / max(1, len(sentences)), 2)

        passive_hits = sum(1 for s in sentences if PASSIVE_RE.search(s))
        passive_ratio = round(min(1.0, passive_hits / max(1, len(sentences))), 3)

        lower_combined = combined.lower()
        hedging_found = [
            phrase for phrase in HEDGING_LEXICON if re.search(rf"\b{re.escape(phrase)}\b", lower_combined)
        ]
        transitions_found = [
            phrase for phrase in TRANSITION_LEXICON if re.search(rf"\b{re.escape(phrase)}\b", lower_combined)
        ]

        apa_count = len(APA_CITE_RE.findall(combined))
        ieee_count = len(IEEE_CITE_RE.findall(combined))
        if ieee_count > apa_count:
            citation_style = "IEEE / Numeric"
        else:
            citation_style = "APA 7"

        all_tokens = re.findall(r"\b\w+\b", lower_combined)
        total_words = len(all_tokens)
        type_token_ratio = round(len(set(all_tokens)) / max(1, total_words), 3)
        first_person_hits = len(FIRST_PERSON_RE.findall(combined))
        first_person_ratio = round(first_person_hits / max(1, total_words), 4)

        if hedging_found and passive_ratio >= 0.25:
            tone = "academic-hedged-formal"
        elif first_person_ratio > 0.015:
            tone = "academic-active-authorial"
        else:
            tone = "academic-analytical"

        summary = t(
            active_locale,
            "style.summary",
            tone=tone,
            avg_len=avg_len,
            passive_pct=int(round(passive_ratio * 100)),
            citation_style=citation_style,
        )

        profile = self.repo.create_style_profile(
            name=req.name.strip(),
            source_files=[src for src, _ in texts],
            tone=tone,
            avg_sentence_length=avg_len,
            passive_voice_ratio=passive_ratio,
            hedging_phrases=hedging_found,
            transition_phrases=transitions_found,
            citation_style=citation_style,
            lexical_preferences={
                "total_words": total_words,
                "sentence_count": len(sentences),
                "type_token_ratio": type_token_ratio,
                "first_person_ratio": first_person_ratio,
            },
            system_prompt_summary=summary,
            is_active=req.set_active,
        )

        # Paragraf parçalarını LanceDB `style_chunks` koleksiyonuna indeksle
        chunk_records: list[dict[str, str]] = []
        for src, content in texts:
            paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if len(p.strip()) >= 20]
            if not paragraphs:
                paragraphs = [content[:1500]]
            for para in paragraphs[:30]:
                chunk_records.append(
                    {
                        "chunk_id": str(uuid.uuid4()),
                        "source_file": src,
                        "text": para[:1500],
                    }
                )

        if chunk_records:
            vectors = self.embedder.embed_texts([c["text"] for c in chunk_records])
            self.vector_store.upsert_style_chunks(profile.id, chunk_records, vectors)

        return profile
