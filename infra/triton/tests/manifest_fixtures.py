"""Fixture builder for the T1 manifest-download smoke test.

Writes N deterministic stub `<name>-v1.tar.gz` archives, their `.sha256`
sidecars, and a `models.json` manifest listing them — all into one directory,
ready to be served over a local HTTP server. The archive layout mirrors
conftest.py's `sample_archive`: each tarball is rooted at `<name>/` with a
`config.pbtxt` and a `1/model.txt` (no `model.onnx`, so the onnx-checker is
exercised on its skip path).
"""
import hashlib
import io
import json
import tarfile
from pathlib import Path
from typing import List


def build_stub_archive(dest_dir: Path, folder_name: str) -> str:
    """Write `<folder_name>-v1.tar.gz` + `.sha256` into dest_dir; return the hash."""
    archive_path = dest_dir / f"{folder_name}-v1.tar.gz"
    with tarfile.open(archive_path, "w:gz", compresslevel=6) as tar:
        for rel, data in (
            (f"{folder_name}/config.pbtxt", b"name: " + folder_name.encode() + b"\n"),
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
    sha256_hex = h.hexdigest()
    (dest_dir / f"{folder_name}-v1.tar.gz.sha256").write_text(
        f"{sha256_hex}  {folder_name}-v1.tar.gz\n"
    )
    return sha256_hex


def build_manifest_fixture(
    root: Path, names: List[str], base_url: str
) -> Path:
    """Populate root with stub archives + sidecars and a models.json manifest.

    Args:
        root: directory served by the local HTTP server.
        names: model folder names to generate.
        base_url: URL prefix the archives are reachable at (e.g.
            "http://127.0.0.1:8000"), used to build each entry's `url`.

    Returns the manifest path (root/models.json).
    """
    root.mkdir(parents=True, exist_ok=True)
    downloads = []
    for name in names:
        build_stub_archive(root, name)
        downloads.append(
            {"name": name, "url": f"{base_url.rstrip('/')}/{name}-v1.tar.gz"}
        )
    manifest_path = root / "models.json"
    manifest_path.write_text(json.dumps({"version": "v1", "downloads": downloads}))
    return manifest_path
