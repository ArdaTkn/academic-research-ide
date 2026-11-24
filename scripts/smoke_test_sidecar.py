#!/usr/bin/env python3
"""Smoke-test the compiled standalone backend sidecar binary end-to-end."""

from __future__ import annotations

import os
import platform
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen
import json

import pymupdf  # Verified against backend/.venv for generating sample PDF bytes


ROOT_DIR = Path(__file__).resolve().parent.parent
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
    arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
    if sys_name == "darwin":
        return f"{arch}-apple-darwin"
    if sys_name == "windows":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def http_get_json(url: str) -> tuple[int, dict | list]:
    with urlopen(url, timeout=3) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main() -> int:
    triple = detect_target_triple()
    ext = ".exe" if "windows" in triple or sys.platform == "win32" else ""
    bin_path = BINARIES_DIR / f"research-ide-backend-{triple}{ext}"
    if not bin_path.exists():
        print(f"ERROR: Sidecar binary not found at {bin_path}", file=sys.stderr)
        return 1

    port = free_port()
    base_url = f"http://127.0.0.1:{port}/api/v1"

    with tempfile.TemporaryDirectory(prefix="ide-sidecar-smoke-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        sample_pdf = tmp_path / "sample.pdf"
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text((72, 72), "Page 1: Remote autonomy increases employee engagement (beta = 0.42, p < 0.01).")
        doc.save(sample_pdf)
        doc.close()

        env = os.environ.copy()
        env["RESEARCH_IDE_DATA_DIR"] = str(tmp_path / "app_data")
        env["RESEARCH_IDE_EMBEDDING_PROVIDER"] = "local_hash"
        env["RESEARCH_IDE_LLM_BASE_URL"] = "http://127.0.0.1:9/v1"
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        proc = subprocess.Popen(
            [str(bin_path), "--host", "127.0.0.1", "--port", str(port)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        try:
            deadline = time.monotonic() + 25.0
            healthy_payload = None
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    out = proc.stdout.read() if proc.stdout else ""
                    raise RuntimeError(f"Sidecar exited prematurely ({proc.returncode}):\n{out}")
                try:
                    status, payload = http_get_json(f"{base_url}/health")
                    if status == 200 and isinstance(payload, dict) and payload.get("status") == "ok":
                        healthy_payload = payload
                        break
                except (URLError, ConnectionError, TimeoutError):
                    time.sleep(0.25)

            if not healthy_payload:
                raise TimeoutError("Timed out waiting for standalone sidecar /api/v1/health")

            assert healthy_payload["sqlite_ok"] is True, healthy_payload
            assert healthy_payload["lancedb_ok"] is True, healthy_payload

            for path in ("/config", "/matrix/scales", "/graph"):
                st, _ = http_get_json(f"{base_url}{path}")
                assert st == 200, f"GET {path} returned {st}"

            # Exercise PyMuPDF + worker pipeline inside the frozen binary (LLM unreachable on port 9 is expected)
            req = Request(
                f"{base_url}/papers/ingest",
                data=json.dumps({"file_paths": [str(sample_pdf)]}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req, timeout=5) as resp:
                assert resp.status == 202
                jobs = json.loads(resp.read().decode("utf-8"))
            job_id = jobs[0]["id"]

            saw_past_pdf_extract = False
            job_deadline = time.monotonic() + 10.0
            last_job = None
            while time.monotonic() < job_deadline:
                _, last_job = http_get_json(f"{base_url}/jobs/{job_id}")
                if isinstance(last_job, dict) and last_job.get("status") in ("parsing_llm", "failed", "completed"):
                    # Verify it was NOT a PyMuPDF / import / schema error
                    err = last_job.get("error_detail") or ""
                    assert "ModuleNotFoundError" not in err, err
                    assert "PDF_CORRUPTED" not in err, err
                    saw_past_pdf_extract = True
                    break
                time.sleep(0.2)

            assert saw_past_pdf_extract, f"Ingestion job did not progress past PDF extraction: {last_job}"
            print(f"Sidecar smoke test PASSED ({triple}, health={healthy_payload})")
            return 0
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
