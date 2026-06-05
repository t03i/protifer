#!/usr/bin/env python3
"""T1 — manifest-download smoke test (no Triton image).

Serves a generated `models.json` plus stub `<name>-v1.tar.gz` archives and
`.sha256` sidecars over a local HTTP server, runs `init_models.py` with
`MODEL_MANIFEST_URL` pointed at it, and asserts the full
fetch-manifest-by-URL → download → verify → extract → layout → idempotence
chain. Exits non-zero on any failed assertion.
"""
import functools
import http.server
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from manifest_fixtures import build_manifest_fixture

HERE = Path(__file__).resolve().parent
INIT_SCRIPT = HERE.parent / "init_models.py"
MODELS = ["stub_alpha", "stub_beta", "stub_gamma"]


def _serve(directory: Path) -> tuple[socketserver.TCPServer, int]:
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(directory)
    )
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def _run_init(manifest_url: str, repo: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(INIT_SCRIPT)],
        env={
            "MODEL_MANIFEST_URL": manifest_url,
            "MODEL_REPOSITORY_PATH": str(repo),
            "REQUIRE_NVIDIA": "false",
            "PATH": "/usr/bin:/bin:/usr/local/bin",
        },
        capture_output=True,
        text=True,
    )


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        served = Path(td) / "served"
        repo = Path(td) / "repo"
        repo.mkdir(parents=True)

        served.mkdir(parents=True)
        httpd, port = _serve(served)
        try:
            base = f"http://127.0.0.1:{port}"
            build_manifest_fixture(served, MODELS, base)
            manifest_url = f"{base}/models.json"

            # First run: fetch by URL, download, verify, extract.
            r1 = _run_init(manifest_url, repo)
            sys.stdout.write(r1.stdout)
            sys.stderr.write(r1.stderr)
            log1 = r1.stdout + r1.stderr
            assert r1.returncode == 0, f"first run exit {r1.returncode}"
            assert "MODEL_MANIFEST_URL" in log1, "manifest not fetched by URL"

            for name in MODELS:
                assert (repo / name / "config.pbtxt").is_file(), f"{name}/config.pbtxt missing"
                assert (repo / name / "1").is_dir(), f"{name}/1/ missing"
                assert (repo / name / ".installed-sha256").is_file(), f"{name} marker missing"

            # onnx-checker skipped for non-model.onnx payload (2.5).
            assert "no model.onnx" in log1, "onnx-checker skip path not exercised"

            # Second run: idempotence — markers hit, entries skipped (2.4).
            r2 = _run_init(manifest_url, repo)
            log2 = r2.stdout + r2.stderr
            assert r2.returncode == 0, f"second run exit {r2.returncode}"
            for name in MODELS:
                assert f"Skipping {name} (marker matches)" in log2, f"{name} not skipped on re-run"

            print("T1 manifest-download smoke: OK")
            return 0
        finally:
            httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())
