# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller specification for the standalone Academic Research IDE FastAPI sidecar."""

from __future__ import annotations

import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

datas = [
    ("app/db/schema.sql", "app/db"),
]
binaries = []
hiddenimports = [
    "app.main",
    "app.api.deps",
    "app.api.drafts",
    "app.api.graph",
    "app.api.matrix",
    "app.api.papers",
    "app.api.system",
    "app.core.config",
    "app.core.errors",
    "app.core.i18n",
    "app.db.sqlite",
    "app.db.vector_store",
    "app.models.schemas",
    "app.pipeline.llm_extractor",
    "app.pipeline.normalizer",
    "app.pipeline.pdf_extractor",
    "app.pipeline.worker",
    "app.services.critic_service",
    "app.services.graph_service",
    "app.services.style_service",
    "sqlite3",
    "fitz",
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_core",
    "pydantic_settings",
    "multipart",
    "python_multipart",
    "httpx",
    "httpcore",
    "anyio",
    "anyio._backends._asyncio",
    "openai",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

for pkg in ("lancedb", "pyarrow", "pymupdf", "pdfplumber", "pdfminer", "pypdfium2"):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas.extend(pkg_datas)
        binaries.extend(pkg_binaries)
        hiddenimports.extend(pkg_hidden)
    except Exception:
        pass

for pkg in ("fastapi", "starlette", "uvicorn", "pydantic", "pydantic_settings"):
    try:
        hiddenimports.extend(collect_submodules(pkg))
    except Exception:
        pass

a = Analysis(
    ["sidecar_main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=list(dict.fromkeys(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest", "_pytest"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Hide console window on Windows so double-click launches cleanly without black CMD flash
use_console = sys.platform != "win32"

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="research-ide-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=use_console,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
