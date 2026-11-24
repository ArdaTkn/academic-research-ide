#!/usr/bin/env python3
"""Cross-platform PyInstaller sidecar builder for Tauri externalBin bundling."""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
BINARIES_DIR = ROOT_DIR / "src-tauri" / "binaries"


def detect_target_triple() -> str:
    try:
        out = subprocess.check_output(["rustc", "-vV"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except Exception:
        pass

    sys_name = platform.system().lower()
    machine = platform.machine().lower()
    if sys_name == "darwin":
        arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
        return f"{arch}-apple-darwin"
    if sys_name == "windows":
        arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
        return f"{arch}-pc-windows-msvc"
    arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
    return f"{arch}-unknown-linux-gnu"


def resolve_pyinstaller() -> list[str]:
    if sys.platform == "win32":
        venv_py = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        venv_py = BACKEND_DIR / ".venv" / "bin" / "python"

    py_exec = str(venv_py if venv_py.exists() else Path(sys.executable))
    return [py_exec, "-m", "PyInstaller"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build PyInstaller backend sidecar for Tauri externalBin")
    parser.add_argument("--target", default=None, help="Override Rust target triple (e.g. aarch64-apple-darwin)")
    parser.add_argument("--skip-if-exists", action="store_true", help="Skip rebuild if sidecar binary already exists")
    args = parser.parse_args()

    target_triple = args.target or detect_target_triple()
    ext = ".exe" if "windows" in target_triple or sys.platform == "win32" else ""
    dest_path = BINARIES_DIR / f"research-ide-backend-{target_triple}{ext}"

    if args.skip_if_exists and dest_path.exists():
        print(f"Sidecar already present at {dest_path} (--skip-if-exists).")
        return 0

    BINARIES_DIR.mkdir(parents=True, exist_ok=True)
    gitkeep = BINARIES_DIR / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.write_text("", encoding="utf-8")

    cmd = [
        *resolve_pyinstaller(),
        "--noconfirm",
        "--clean",
        "--distpath",
        str(BACKEND_DIR / "dist"),
        "--workpath",
        str(BACKEND_DIR / "build"),
        str(BACKEND_DIR / "sidecar.spec"),
    ]
    print(f"Building standalone sidecar for {target_triple}...")
    pyi_cache_dir = BACKEND_DIR / "build" / "pyinstaller_cache"
    pyi_cache_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYINSTALLER_CONFIG_DIR", str(pyi_cache_dir))
    subprocess.run(cmd, cwd=BACKEND_DIR, env=env, check=True)

    built_bin = BACKEND_DIR / "dist" / f"research-ide-backend{ext}"
    if not built_bin.exists():
        print(f"ERROR: Expected PyInstaller output missing at {built_bin}", file=sys.stderr)
        return 1

    shutil.copy2(built_bin, dest_path)
    if ext == "":
        mode = dest_path.stat().st_mode
        dest_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    size_mb = dest_path.stat().st_size / (1024 * 1024)
    print(f"Sidecar ready: {dest_path} ({size_mb:.1f} MiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
