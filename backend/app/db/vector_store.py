from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Protocol

import httpx
import lancedb
import pyarrow as pa

from app.core.errors import ServiceUnavailableError
from app.pipeline.pdf_extractor import DocumentChunk


class EmbeddingProvider(Protocol):
    dim: int

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...


class LocalHashEmbedder:
    """Deterministic local feature-hashing embedder for offline tests & fallback."""

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dim
            tokens = [tok for tok in text.lower().split() if tok]
            if not tokens:
                vec[0] = 1.0
                vectors.append(vec)
                continue
            for token in tokens:
                digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
                idx = int.from_bytes(digest[:4], "little") % self.dim
                sign = 1.0 if (digest[4] & 1) == 0 else -1.0
                vec[idx] += sign
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            vectors.append([v / norm for v in vec])
        return vectors


class OpenAICompatibleEmbedder:
    """Calls an OpenAI-compatible /embeddings endpoint (Ollama, LM Studio, OpenAI)."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str = "",
        dim: int = 384,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.dim = dim
        self.timeout_seconds = timeout_seconds

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url}/embeddings"
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    url,
                    headers=headers,
                    json={"model": self.model, "input": texts},
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPError as exc:
            raise ServiceUnavailableError(
                error_code="EMBEDDING_SERVICE_UNAVAILABLE",
                message="Gömme (embedding) servisine bağlanılamadı.",
                details={"url": url, "model": self.model, "error": str(exc)},
            ) from exc

        data = payload.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise ServiceUnavailableError(
                error_code="EMBEDDING_INVALID_RESPONSE",
                message="Gömme servisi beklenen sayıda vektör döndürmedi.",
                details={"expected": len(texts), "received": len(data) if isinstance(data, list) else None},
            )

        ordered = sorted(data, key=lambda item: item.get("index", 0))
        vectors: list[list[float]] = []
        for item in ordered:
            vec = item.get("embedding")
            if not isinstance(vec, list) or len(vec) != self.dim:
                raise ServiceUnavailableError(
                    error_code="EMBEDDING_DIMENSION_MISMATCH",
                    message="Gömme vektör boyutu yapılandırılmış şemayla uyuşmuyor.",
                    details={"expected_dim": self.dim, "actual_dim": len(vec) if isinstance(vec, list) else None},
                )
            vectors.append([float(x) for x in vec])
        return vectors


class VectorStore:
    """Embedded LanceDB store managing `paper_chunks` and `style_chunks`."""

    PAPER_CHUNKS_TABLE = "paper_chunks"
    STYLE_CHUNKS_TABLE = "style_chunks"

    def __init__(self, lancedb_dir: Path, embedding_dim: int = 384) -> None:
        self.lancedb_dir = lancedb_dir
        self.embedding_dim = embedding_dim
        self._paper_schema = pa.schema(
            [
                pa.field("chunk_id", pa.string()),
                pa.field("paper_id", pa.string()),
                pa.field("page_number", pa.int32()),
                pa.field("section_name", pa.string()),
                pa.field("chunk_index", pa.int32()),
                pa.field("text", pa.string()),
                pa.field("vector", pa.list_(pa.float32(), embedding_dim)),
            ]
        )
        self._style_schema = pa.schema(
            [
                pa.field("chunk_id", pa.string()),
                pa.field("style_profile_id", pa.string()),
                pa.field("source_file", pa.string()),
                pa.field("text", pa.string()),
                pa.field("vector", pa.list_(pa.float32(), embedding_dim)),
            ]
        )

    def _connect(self) -> lancedb.DBConnection:
        self.lancedb_dir.mkdir(parents=True, exist_ok=True)
        return lancedb.connect(str(self.lancedb_dir))

    @staticmethod
    def _table_names(db: lancedb.DBConnection) -> set[str]:
        return set(db.list_tables().tables)

    def initialize(self) -> None:
        db = self._connect()
        existing = self._table_names(db)
        if self.PAPER_CHUNKS_TABLE not in existing:
            db.create_table(self.PAPER_CHUNKS_TABLE, schema=self._paper_schema)
        if self.STYLE_CHUNKS_TABLE not in existing:
            db.create_table(self.STYLE_CHUNKS_TABLE, schema=self._style_schema)

    def health_check(self) -> bool:
        try:
            db = self._connect()
            names = self._table_names(db)
            return self.PAPER_CHUNKS_TABLE in names and self.STYLE_CHUNKS_TABLE in names
        except Exception:
            return False

    def upsert_paper_chunks(
        self,
        paper_id: str,
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
    ) -> int:
        if len(chunks) != len(vectors):
            raise ValueError("Chunk sayısı ile vektör sayısı eşleşmiyor.")
        db = self._connect()
        table = db.open_table(self.PAPER_CHUNKS_TABLE)
        safe_id = paper_id.replace("'", "''")
        table.delete(f"paper_id = '{safe_id}'")
        if not chunks:
            return 0
        rows = [
            {
                "chunk_id": c.chunk_id,
                "paper_id": c.paper_id,
                "page_number": int(c.page_number),
                "section_name": c.section_name or "",
                "chunk_index": int(c.chunk_index),
                "text": c.text,
                "vector": [float(x) for x in vec],
            }
            for c, vec in zip(chunks, vectors, strict=True)
        ]
        table.add(rows)
        return len(rows)

    def delete_paper_chunks(self, paper_id: str) -> None:
        db = self._connect()
        if self.PAPER_CHUNKS_TABLE not in self._table_names(db):
            return
        table = db.open_table(self.PAPER_CHUNKS_TABLE)
        safe_id = paper_id.replace("'", "''")
        table.delete(f"paper_id = '{safe_id}'")

    def search_paper_chunks(
        self,
        query_vector: list[float],
        limit: int = 8,
        paper_id: str | None = None,
    ) -> list[dict[str, object]]:
        db = self._connect()
        table = db.open_table(self.PAPER_CHUNKS_TABLE)
        query = table.search(query_vector).limit(limit)
        if paper_id:
            safe_id = paper_id.replace("'", "''")
            query = query.where(f"paper_id = '{safe_id}'")
        results = query.to_list()
        return [
            {
                "chunk_id": r["chunk_id"],
                "paper_id": r["paper_id"],
                "page_number": int(r["page_number"]),
                "section_name": r["section_name"],
                "chunk_index": int(r["chunk_index"]),
                "text": r["text"],
                "_distance": float(r.get("_distance", 0.0)),
            }
            for r in results
        ]

    def upsert_style_chunks(
        self,
        style_profile_id: str,
        chunks: list[dict[str, str]],
        vectors: list[list[float]],
    ) -> int:
        if len(chunks) != len(vectors):
            raise ValueError("Stil parçası sayısı ile vektör sayısı eşleşmiyor.")
        db = self._connect()
        table = db.open_table(self.STYLE_CHUNKS_TABLE)
        safe_id = style_profile_id.replace("'", "''")
        table.delete(f"style_profile_id = '{safe_id}'")
        if not chunks:
            return 0
        rows = [
            {
                "chunk_id": c["chunk_id"],
                "style_profile_id": style_profile_id,
                "source_file": c["source_file"],
                "text": c["text"],
                "vector": [float(x) for x in vec],
            }
            for c, vec in zip(chunks, vectors, strict=True)
        ]
        table.add(rows)
        return len(rows)

    def delete_style_chunks(self, style_profile_id: str) -> None:
        db = self._connect()
        if self.STYLE_CHUNKS_TABLE not in self._table_names(db):
            return
        table = db.open_table(self.STYLE_CHUNKS_TABLE)
        safe_id = style_profile_id.replace("'", "''")
        table.delete(f"style_profile_id = '{safe_id}'")

    def search_style_chunks(
        self,
        query_vector: list[float],
        style_profile_id: str | None = None,
        limit: int = 5,
    ) -> list[dict[str, object]]:
        db = self._connect()
        table = db.open_table(self.STYLE_CHUNKS_TABLE)
        query = table.search(query_vector).limit(limit)
        if style_profile_id:
            safe_id = style_profile_id.replace("'", "''")
            query = query.where(f"style_profile_id = '{safe_id}'")
        results = query.to_list()
        return [
            {
                "chunk_id": r["chunk_id"],
                "style_profile_id": r["style_profile_id"],
                "source_file": r["source_file"],
                "text": r["text"],
                "_distance": float(r.get("_distance", 0.0)),
            }
            for r in results
        ]

    @staticmethod
    def _serialize_meta(data: dict[str, object]) -> str:
        return json.dumps(data)
