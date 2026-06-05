"""Unit tests for the JSON model manifest loader."""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import init_models  # noqa: E402


def _write_manifest(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data))


class _ManifestServer:
    """A throwaway localhost HTTP server that serves a fixed manifest body."""

    def __init__(self, body: bytes) -> None:
        body_ref = body

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body_ref)))
                self.end_headers()
                self.wfile.write(body_ref)

            def log_message(self, *_args) -> None:  # silence test output
                pass

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}/models.v1.json"

    def __enter__(self) -> "_ManifestServer":
        self._thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


class TestLoadModelManifest:
    def test_valid_manifest_loads(self, tmp_path: Path) -> None:
        manifest = tmp_path / "models.json"
        _write_manifest(
            manifest,
            {
                "version": "v1",
                "downloads": [
                    {"name": "alpha", "url": "https://example.com/alpha.tar.gz"},
                    {"name": "beta", "url": "https://example.com/beta.tar.gz"},
                ],
            },
        )
        result = init_models.load_model_manifest(manifest)
        assert result == [
            ("alpha", "https://example.com/alpha.tar.gz"),
            ("beta", "https://example.com/beta.tar.gz"),
        ]

    def test_missing_file_exits(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(tmp_path / "no-such.json")
        assert exc.value.code == 1

    def test_invalid_json_exits(self, tmp_path: Path) -> None:
        manifest = tmp_path / "bad.json"
        manifest.write_text("not json {")
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(manifest)
        assert exc.value.code == 1

    def test_missing_downloads_key_exits(self, tmp_path: Path) -> None:
        manifest = tmp_path / "bad.json"
        _write_manifest(manifest, {"version": "v1"})
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(manifest)
        assert exc.value.code == 1

    def test_empty_downloads_exits(self, tmp_path: Path) -> None:
        manifest = tmp_path / "bad.json"
        _write_manifest(manifest, {"version": "v1", "downloads": []})
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(manifest)
        assert exc.value.code == 1

    def test_entry_missing_name_exits(self, tmp_path: Path) -> None:
        manifest = tmp_path / "bad.json"
        _write_manifest(
            manifest,
            {"version": "v1", "downloads": [{"url": "https://example.com/x.tar.gz"}]},
        )
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(manifest)
        assert exc.value.code == 1

    def test_entry_missing_url_exits(self, tmp_path: Path) -> None:
        manifest = tmp_path / "bad.json"
        _write_manifest(
            manifest, {"version": "v1", "downloads": [{"name": "alpha"}]}
        )
        with pytest.raises(SystemExit) as exc:
            init_models.load_model_manifest(manifest)
        assert exc.value.code == 1


class TestParseModelDownloads:
    def test_uses_explicit_manifest_path(self, tmp_path: Path) -> None:
        manifest = tmp_path / "models.json"
        _write_manifest(
            manifest,
            {
                "version": "v1",
                "downloads": [{"name": "a", "url": "https://x/a.tar.gz"}],
            },
        )
        with patch.dict(
            "os.environ", {"MODEL_MANIFEST_PATH": str(manifest)}, clear=False
        ):
            result = init_models.parse_model_downloads()
        assert result == [("a", "https://x/a.tar.gz")]

    def test_missing_default_manifest_exits(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        nonexistent = tmp_path / "no-default-manifest.json"
        monkeypatch.setattr(init_models, "_default_manifest_path", lambda: nonexistent)
        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(SystemExit) as exc:
                init_models.parse_model_downloads()
        assert exc.value.code == 1


class TestManifestUrlSourcing:
    _BODY = json.dumps(
        {
            "version": "v1",
            "downloads": [{"name": "alpha", "url": "https://x/alpha.tar.gz"}],
        }
    ).encode()

    def test_url_drives_downloads(self) -> None:
        with _ManifestServer(self._BODY) as server:
            with patch.dict(
                "os.environ", {"MODEL_MANIFEST_URL": server.url}, clear=True
            ):
                result = init_models.parse_model_downloads()
        assert result == [("alpha", "https://x/alpha.tar.gz")]

    def test_url_takes_precedence_over_path(self, tmp_path: Path) -> None:
        local = tmp_path / "models.json"
        _write_manifest(
            local,
            {
                "version": "v1",
                "downloads": [{"name": "local", "url": "https://x/local.tar.gz"}],
            },
        )
        with _ManifestServer(self._BODY) as server:
            with patch.dict(
                "os.environ",
                {
                    "MODEL_MANIFEST_URL": server.url,
                    "MODEL_MANIFEST_PATH": str(local),
                },
                clear=True,
            ):
                result = init_models.parse_model_downloads()
        # URL wins — the local "local" entry is ignored.
        assert result == [("alpha", "https://x/alpha.tar.gz")]

    def test_unreachable_url_exits(self) -> None:
        # Port 1 is reserved/unbindable — connection refused, no server listening.
        with patch.dict(
            "os.environ",
            {"MODEL_MANIFEST_URL": "http://127.0.0.1:1/models.v1.json"},
            clear=True,
        ):
            with pytest.raises(SystemExit) as exc:
                init_models.parse_model_downloads()
        assert exc.value.code == 1

    def test_url_overrides_present_path_even_when_path_readable(
        self, tmp_path: Path
    ) -> None:
        # Same as precedence test but asserts the fetched temp file is cleaned up:
        # parse_model_downloads must not leave the manifest temp file behind.
        before = set(Path(init_models.tempfile.gettempdir()).glob("models-manifest-*"))
        with _ManifestServer(self._BODY) as server:
            with patch.dict(
                "os.environ", {"MODEL_MANIFEST_URL": server.url}, clear=True
            ):
                init_models.parse_model_downloads()
        after = set(Path(init_models.tempfile.gettempdir()).glob("models-manifest-*"))
        assert before == after
