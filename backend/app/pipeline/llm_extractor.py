from __future__ import annotations

import json
import re
from typing import Protocol

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, OpenAIError
from pydantic import ValidationError

from app.core.errors import ExtractionValidationError, ServiceUnavailableError
from app.models.schemas import PaperExtractionPayload
from app.pipeline.pdf_extractor import ExtractedDocument


class LLMExtractor(Protocol):
    async def extract(self, doc: ExtractedDocument) -> PaperExtractionPayload:
        ...


SYSTEM_PROMPT = """You are an academic research extraction engine.
Extract structured metadata, sample profile, variables (with roles), empirical relationships, psychometric scales, and page-referenced main claims from the provided academic paper.

STRICT RULES:
1. Return ONLY a valid JSON object matching the exact schema below. Do NOT wrap in prose.
2. Every item in `relationships`, `scales`, and `claims` MUST include an integer `page_number` >= 1 matching the [PAGE N] marker where it appears.
3. NEVER fabricate or guess missing statistics (`cronbach_alpha`, `item_count`, `sample_size`, `effect_size`, `p_value`, `year`, `doi`). If not explicitly reported in the text, set the field to `null`.
4. Allowed `role` values: "independent", "dependent", "mediator", "moderator", "control", "outcome".
5. Allowed `direction` values: "positive", "negative", "insignificant", "mixed", "curvilinear".
6. Allowed `claim_type` values: "main_finding", "hypothesis", "limitation", "theoretical", "methodological".

JSON SCHEMA SHAPE:
{
  "metadata": {
    "title": "string (required)",
    "authors": ["string"],
    "year": 2024 | null,
    "journal": "string | null",
    "doi": "string | null",
    "abstract": "string | null",
    "language": "en"
  },
  "sample_profile": {
    "sample_size": 250 | null,
    "sample_population": "string | null",
    "sampling_method": "string | null",
    "study_context": "string | null",
    "statistical_methods": ["string"],
    "research_design": "string | null"
  },
  "variables": [
    {
      "name": "string",
      "role": "independent | dependent | mediator | moderator | control | outcome",
      "definition": "string | null",
      "page_number": 1 | null
    }
  ],
  "relationships": [
    {
      "source_variable": "string",
      "target_variable": "string",
      "source_role": "independent | ... | null",
      "target_role": "dependent | ... | null",
      "direction": "positive | negative | insignificant | mixed | curvilinear",
      "effect_size": 0.42 | null,
      "effect_metric": "beta | r | OR | d | null",
      "p_value": "< 0.001" | null,
      "statistical_method": "SEM | regression | ... | null",
      "mediator_variable": "string | null",
      "moderator_variable": "string | null",
      "sample_subgroup": "string | null",
      "page_number": 5,
      "quote_snippet": "string | null",
      "confidence_score": 0.85
    }
  ],
  "scales": [
    {
      "variable_name": "string | null",
      "name": "string",
      "original_authors": "string | null",
      "original_year": 2010 | null,
      "item_count": 10 | null,
      "cronbach_alpha": 0.89 | null,
      "composite_reliability": 0.91 | null,
      "ave": 0.64 | null,
      "response_format": "5-point Likert | null",
      "language": "string | null",
      "sample_size_override": null,
      "adaptation_notes": "string | null",
      "page_number": 4
    }
  ],
  "claims": [
    {
      "claim_text": "string",
      "claim_type": "main_finding | hypothesis | limitation | theoretical | methodological",
      "page_number": 7,
      "section_name": "string | null",
      "quote_snippet": "string | null",
      "confidence_score": 0.9
    }
  ]
}"""


def _strip_code_fences(raw_text: str) -> str:
    cleaned = raw_text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL | re.IGNORECASE)
    if fence_match:
        return fence_match.group(1).strip()
    return cleaned


def validate_payload_against_document(
    payload: PaperExtractionPayload,
    page_count: int,
) -> PaperExtractionPayload:
    """Enforce document-level invariants (e.g., all page_number references within 1..page_count)."""
    out_of_bounds: list[dict[str, object]] = []

    for idx, var in enumerate(payload.variables):
        if var.page_number is not None and var.page_number > page_count:
            out_of_bounds.append({"section": "variables", "index": idx, "page_number": var.page_number})

    for idx, rel in enumerate(payload.relationships):
        if rel.page_number > page_count:
            out_of_bounds.append({"section": "relationships", "index": idx, "page_number": rel.page_number})

    for idx, scale in enumerate(payload.scales):
        if scale.page_number > page_count:
            out_of_bounds.append({"section": "scales", "index": idx, "page_number": scale.page_number})

    for idx, claim in enumerate(payload.claims):
        if claim.page_number > page_count:
            out_of_bounds.append({"section": "claims", "index": idx, "page_number": claim.page_number})

    if out_of_bounds:
        raise ExtractionValidationError(
            error_code="EXTRACTION_PAGE_OUT_OF_BOUNDS",
            message="LLM çıkarımı belgedeki toplam sayfa sayısını aşan sayfa referansları içeriyor.",
            details={"page_count": page_count, "invalid_references": out_of_bounds},
        )
    return payload


class OpenAICompatibleLLMExtractor:
    """Structured PaperExtractionPayload extractor using OpenAI-compatible Chat Completions."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str = "",
        max_retries: int = 2,
        timeout_seconds: float = 120.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key or "ollama"
        self.max_retries = max_retries
        self.timeout_seconds = timeout_seconds

    async def extract(self, doc: ExtractedDocument) -> PaperExtractionPayload:
        client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            timeout=self.timeout_seconds,
        )
        doc_text = doc.format_for_llm()
        messages: list[dict[str, str]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Document filename: {doc.file_path.name}\n"
                    f"Total pages: {doc.page_count}\n\n"
                    f"{doc_text}"
                ),
            },
        ]

        last_error_details: dict[str, object] = {}
        try:
            for attempt in range(self.max_retries + 1):
                try:
                    completion = await client.chat.completions.create(
                        model=self.model,
                        messages=messages,  # type: ignore[arg-type]
                        temperature=0.0,
                        response_format={"type": "json_object"},
                    )
                except (APIConnectionError, APITimeoutError) as exc:
                    raise ServiceUnavailableError(
                        error_code="LLM_SERVICE_UNAVAILABLE",
                        message="LLM çıkarım servisine bağlanılamadı.",
                        details={"base_url": self.base_url, "model": self.model, "error": str(exc)},
                    ) from exc
                except OpenAIError as exc:
                    raise ServiceUnavailableError(
                        error_code="LLM_PROVIDER_ERROR",
                        message="LLM sağlayıcısı hata döndürdü.",
                        details={"base_url": self.base_url, "model": self.model, "error": str(exc)},
                    ) from exc

                raw_content = completion.choices[0].message.content or ""
                cleaned_json = _strip_code_fences(raw_content)

                try:
                    parsed = json.loads(cleaned_json)
                    payload = PaperExtractionPayload.model_validate(parsed)
                    return validate_payload_against_document(payload, doc.page_count)
                except (json.JSONDecodeError, ValidationError, ExtractionValidationError) as exc:
                    err_msg = str(exc)
                    last_error_details = {
                        "attempt": attempt + 1,
                        "error": err_msg,
                        "raw_preview": raw_content[:500],
                    }
                    if attempt < self.max_retries:
                        messages.append({"role": "assistant", "content": raw_content})
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    "Your previous JSON output failed strict schema validation:\n"
                                    f"{err_msg}\n"
                                    f"Remember: total pages = {doc.page_count}, all page_number values must be >= 1 and <= {doc.page_count}, "
                                    "and return ONLY valid JSON."
                                ),
                            }
                        )
                        continue
                    raise ExtractionValidationError(
                        error_code="LLM_EXTRACTION_VALIDATION_FAILED",
                        message="LLM yapılandırılmış çıkarım çıktısı şema doğrulamasından geçemedi.",
                        details=last_error_details,
                    ) from exc
        finally:
            await client.close()

        raise ExtractionValidationError(
            error_code="LLM_EXTRACTION_VALIDATION_FAILED",
            message="LLM yapılandırılmış çıkarım çıktısı doğrulamadı.",
            details=last_error_details,
        )
