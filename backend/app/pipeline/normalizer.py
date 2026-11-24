from __future__ import annotations

import re
import unicodedata


def normalize_variable_key(name: str) -> str:
    """Produce a deterministic canonical key for matching variable aliases."""
    normalized = unicodedata.normalize("NFKD", name)
    ascii_like = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    lowered = ascii_like.lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", lowered)
    return " ".join(cleaned.split())


def clean_display_label(name: str) -> str:
    """Clean whitespace in a human-readable variable display label."""
    return " ".join(name.strip().split())
