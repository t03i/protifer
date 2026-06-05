"""Pytest fixtures for infra/triton/tests/.

Wave 0: establishes shared fixtures so individual test files stay focused.
"""
import hashlib
import io
import logging
import tarfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _capture_info_logs(caplog):
    """Capture INFO-level records by default so tests asserting on log messages
    emitted by init_models (which uses logging.INFO via basicConfig) can see
    them. Pytest's caplog defaults to WARNING; tests like
    test_require_false_skips assert against an INFO log, so we lower the
    threshold here once for all tests in this directory.
    """
    caplog.set_level(logging.INFO)


@pytest.fixture
def tmp_model_repo(tmp_path: Path) -> Path:
    """Simulated /models volume root — each test gets a fresh one."""
    repo = tmp_path / "models"
    repo.mkdir()
    return repo


@pytest.fixture
def tmp_download_dir(tmp_path: Path) -> Path:
    """Simulated /tmp staging area for downloads."""
    d = tmp_path / "downloads"
    d.mkdir()
    return d


@pytest.fixture
def sample_archive(tmp_download_dir: Path):
    """Factory: build a deterministic {folder}/config.pbtxt + 1/model.txt tar.gz.

    Returns (archive_path, sha256_hex). The archive is well-formed and its
    SHA256 matches the returned hash — use for positive-path tests.
    """

    def _build(
        folder_name: str = "fake_model", content: bytes = b"fake config\n"
    ) -> tuple[Path, str]:
        archive_path = tmp_download_dir / f"{folder_name}-v1.tar.gz"
        with tarfile.open(archive_path, "w:gz", compresslevel=6) as tar:
            for rel, data in (
                (f"{folder_name}/config.pbtxt", content),
                (f"{folder_name}/1/model.txt", b"hello\n"),
            ):
                ti = tarfile.TarInfo(name=rel)
                ti.size = len(data)
                ti.mtime = 0
                ti.uid = ti.gid = 0
                ti.uname = ti.gname = ""
                ti.mode = 0o644
                tar.addfile(ti, io.BytesIO(data))
        h = hashlib.sha256()
        with open(archive_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return archive_path, h.hexdigest()

    return _build


@pytest.fixture
def corrupt_archive(sample_archive):
    """Factory: returns (archive_path, WRONG sha256) — for SHA-mismatch tests."""

    def _build(folder_name: str = "fake_model") -> tuple[Path, str]:
        archive_path, _actual = sample_archive(folder_name)
        return archive_path, "0" * 64  # definitely not the real SHA

    return _build
