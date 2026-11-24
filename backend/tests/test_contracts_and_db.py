from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from app.core.config import Settings, resolve_os_app_data_dir
from app.db.sqlite import ResearchRepository, SQLiteDatabase
from app.db.vector_store import LocalHashEmbedder, VectorStore
from app.pipeline.pdf_extractor import DocumentChunk


def test_schema_sql_matches_contracts_md() -> None:
    contracts_path = Path(__file__).resolve().parents[2] / ".agent_state" / "SCHEMA_AND_CONTRACTS.md"
    schema_sql_path = Path(__file__).resolve().parents[1] / "app" / "db" / "schema.sql"

    contracts_text = contracts_path.read_text(encoding="utf-8")
    match = re.search(r"```sql\n(.*?)\n```", contracts_text, re.DOTALL)
    assert match is not None

    conn_contract = sqlite3.connect(":memory:")
    conn_contract.executescript(match.group(1))
    contract_objs = conn_contract.execute(
        "SELECT type, name FROM sqlite_master ORDER BY type, name"
    ).fetchall()

    conn_app = sqlite3.connect(":memory:")
    conn_app.executescript(schema_sql_path.read_text(encoding="utf-8"))
    app_objs = conn_app.execute(
        "SELECT type, name FROM sqlite_master ORDER BY type, name"
    ).fetchall()

    assert contract_objs == app_objs


def test_sqlite_pragmas_fts5_and_lancedb_roundtrip(
    temp_settings: Settings,
    local_embedder: LocalHashEmbedder,
) -> None:
    db = SQLiteDatabase(temp_settings.sqlite_path)
    db.initialize()
    assert db.health_check() is True

    with db.connect() as conn:
        fk = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
        journal = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        assert fk == 1
        assert str(journal).lower() == "wal"

    repo = ResearchRepository(db)
    paper = repo.create_or_reset_paper_stub(
        file_path="/tmp/demo.pdf",
        file_hash_sha256="abc123",
        page_count=3,
        title_hint="Demo",
    )
    assert paper.id

    vs = VectorStore(temp_settings.lancedb_dir, embedding_dim=384)
    vs.initialize()
    assert vs.health_check() is True

    chunks = [
        DocumentChunk(
            chunk_id="c1",
            paper_id=paper.id,
            page_number=2,
            section_name="Results",
            chunk_index=0,
            text="Transformational leadership positively predicted employee engagement.",
        )
    ]
    vecs = local_embedder.embed_texts([c.text for c in chunks])
    assert vs.upsert_paper_chunks(paper.id, chunks, vecs) == 1

    hits = vs.search_paper_chunks(vecs[0], limit=3)
    assert len(hits) == 1
    assert hits[0]["paper_id"] == paper.id
    assert hits[0]["page_number"] == 2

    style_chunks = [{"chunk_id": "s1", "source_file": "past.md", "text": "Our empirical findings indicate..."}]
    s_vecs = local_embedder.embed_texts([style_chunks[0]["text"]])
    assert vs.upsert_style_chunks("profile-1", style_chunks, s_vecs) == 1
    s_hits = vs.search_style_chunks(s_vecs[0], style_profile_id="profile-1", limit=2)
    assert len(s_hits) == 1
    assert s_hits[0]["style_profile_id"] == "profile-1"

    vs.delete_paper_chunks(paper.id)
    assert vs.search_paper_chunks(vecs[0], limit=3) == []


def test_cross_platform_os_app_data_dir_resolution() -> None:
    fake_home = Path("/home/researcher")
    assert resolve_os_app_data_dir(platform="darwin", env={}, home=fake_home) == (
        fake_home / "Library" / "Application Support" / "academic-research-ide"
    )
    assert resolve_os_app_data_dir(
        platform="linux",
        env={"XDG_DATA_HOME": "/xdg/data"},
        home=fake_home,
    ) == Path("/xdg/data/academic-research-ide")
    assert resolve_os_app_data_dir(platform="linux", env={}, home=fake_home) == (
        fake_home / ".local" / "share" / "academic-research-ide"
    )
    assert resolve_os_app_data_dir(
        platform="win32",
        env={"APPDATA": "C:/Users/Researcher/AppData/Roaming"},
        home=fake_home,
    ) == Path("C:/Users/Researcher/AppData/Roaming/academic-research-ide")
