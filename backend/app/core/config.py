from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


APP_DIR_NAME = "academic-research-ide"


def resolve_os_app_data_dir(
    *,
    platform: str | None = None,
    env: dict[str, str] | None = None,
    home: Path | None = None,
) -> Path:
    """Resolve the OS-standard per-user application data directory (Windows/macOS/Linux)."""
    plat = platform or sys.platform
    environ = env if env is not None else os.environ
    home_dir = home or Path.home()

    if plat.startswith("win"):
        appdata = environ.get("APPDATA") or environ.get("LOCALAPPDATA")
        base = Path(appdata) if appdata else (home_dir / "AppData" / "Roaming")
        return base / APP_DIR_NAME

    if plat == "darwin":
        return home_dir / "Library" / "Application Support" / APP_DIR_NAME

    xdg_data_home = environ.get("XDG_DATA_HOME")
    base = Path(xdg_data_home) if xdg_data_home else (home_dir / ".local" / "share")
    return base / APP_DIR_NAME


def _default_data_dir() -> Path:
    return resolve_os_app_data_dir()


class Settings(BaseSettings):
    """Runtime settings for the local Academic Research IDE backend."""

    model_config = SettingsConfigDict(env_prefix="RESEARCH_IDE_", extra="ignore")

    app_version: str = "0.1.0"
    api_host: str = "127.0.0.1"
    api_port: int = 8765

    data_dir: Path = Field(default_factory=_default_data_dir)

    llm_provider: str = "ollama"
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_model: str = "qwen2.5:14b"
    llm_api_key: str = ""

    embedding_provider: str = "openai_compatible"
    embedding_base_url: str | None = None
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384

    @property
    def sqlite_path(self) -> Path:
        return self.data_dir / "db" / "research.db"

    @property
    def lancedb_dir(self) -> Path:
        return self.data_dir / "lancedb"

    @property
    def pdfs_dir(self) -> Path:
        return self.data_dir / "pdfs"

    @property
    def config_file(self) -> Path:
        return self.data_dir / "config.json"

    def ensure_data_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self.lancedb_dir.mkdir(parents=True, exist_ok=True)
        self.pdfs_dir.mkdir(parents=True, exist_ok=True)

    def load_persisted_overrides(self) -> None:
        if not self.config_file.exists():
            return
        try:
            raw = json.loads(self.config_file.read_text(encoding="utf-8"))
        except Exception:
            return
        if not isinstance(raw, dict):
            return
        allowed = {
            "llm_provider",
            "llm_base_url",
            "llm_model",
            "llm_api_key",
            "embedding_provider",
            "embedding_base_url",
            "embedding_model",
            "embedding_dim",
        }
        for key, value in raw.items():
            if key in allowed and value is not None:
                setattr(self, key, value)

    def save_persisted_overrides(self, patch: dict[str, Any]) -> None:
        self.ensure_data_dirs()
        allowed = {
            "llm_provider",
            "llm_base_url",
            "llm_model",
            "llm_api_key",
            "embedding_provider",
            "embedding_base_url",
            "embedding_model",
            "embedding_dim",
        }
        existing: dict[str, Any] = {}
        if self.config_file.exists():
            try:
                loaded = json.loads(self.config_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    existing = loaded
            except Exception:
                existing = {}
        for key, value in patch.items():
            if key in allowed and value is not None:
                setattr(self, key, value)
                existing[key] = value
        self.config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    def public_dict(self) -> dict[str, Any]:
        masked_key = ""
        if self.llm_api_key:
            masked_key = (
                f"{self.llm_api_key[:3]}***{self.llm_api_key[-2:]}"
                if len(self.llm_api_key) > 6
                else "***"
            )
        return {
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
            "llm_base_url": self.llm_base_url,
            "embedding_provider": self.embedding_provider,
            "embedding_base_url": self.embedding_base_url,
            "embedding_model": self.embedding_model,
            "embedding_dim": self.embedding_dim,
            "has_api_key": bool(self.llm_api_key),
            "llm_api_key_masked": masked_key,
        }
