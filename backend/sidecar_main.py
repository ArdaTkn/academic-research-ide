from __future__ import annotations

import argparse
import multiprocessing
import os
import sys
from pathlib import Path

# Ensure UTF-8 I/O across Windows/macOS/Linux frozen binaries
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Ensure PyInstaller sees backend modules reliably
_BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if str(_BASE_DIR) not in sys.path:
    sys.path.insert(0, str(_BASE_DIR))

import fitz  # noqa: E402, F401
import lancedb  # noqa: E402, F401
import pdfplumber  # noqa: E402, F401
import pyarrow  # noqa: E402, F401
import sqlite3  # noqa: E402, F401
import uvicorn  # noqa: E402

from app.main import app  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Academic Research IDE FastAPI Sidecar")
    parser.add_argument("--host", default=os.environ.get("RESEARCH_IDE_API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("RESEARCH_IDE_API_PORT", "8765")))
    args = parser.parse_args()

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
