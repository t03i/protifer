#!/usr/bin/env python3
"""Initialize Triton model repository by downloading ONNX models.

This script is run as an init container before Triton starts.
It downloads ONNX models from configured URLs and places them
in the correct directory structure based on explicit folder:url pairs.

The download list comes from a JSON manifest resolved in this order:
  1. MODEL_MANIFEST_URL — fetched over HTTPS (redirects followed) to a temp
     file, then parsed. This is the production path; the URL may be pinned
     (`…/releases/download/<tag>/models.v1.json`) or latest
     (`…/releases/latest/download/models.v1.json`).
  2. MODEL_MANIFEST_PATH — a local file (default /etc/protifer/models.json),
     used as the fallback for air-gapped/local runs when no URL is set.
A missing/unreachable/malformed manifest fails loudly (non-zero exit).
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Literal, Tuple

import httpx
import onnx
from tqdm import tqdm

# Configure logging
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Model repository base path
MODEL_REPO_PATH = Path(os.getenv("MODEL_REPOSITORY_PATH", "/models"))

# CPU conda-pack env baked into this image, staged into the shared model volume.
EXECUTION_ENV_SRC = Path(os.getenv("EXECUTION_ENV_SRC", "/opt/protifer/cpu_py312.tar.gz"))
EXECUTION_ENV_DEST = MODEL_REPO_PATH / "_envs" / "cpu_py312.tar.gz"


@dataclass
class ArtifactError:
    """Captures per-artifact failure details for the end-of-run summary (D-15)."""

    folder: str
    stage: Literal["sidecar_fetch", "download", "sha_mismatch", "extract", "onnx_checker"]
    cause: str


def is_archive_url(url: str) -> bool:
    """Check if URL points to an archive file.

    Args:
        url: URL to check

    Returns:
        True if URL ends with .tar.gz or .tgz, False otherwise
    """
    return url.endswith(".tar.gz") or url.endswith(".tgz")


def parse_folder_spec(folder_spec: str) -> Tuple[str, str]:
    """Parse folder specification into folder name and version.

    Examples:
        "tmbed/1" -> ("tmbed", "1")
        "tmbed" -> ("tmbed", "1")
        "_internal_esm2_t33_onnx/2" -> ("_internal_esm2_t33_onnx", "2")

    Args:
        folder_spec: Folder specification string

    Returns:
        Tuple of (folder_name, version)
    """
    if "/" in folder_spec:
        folder, version = folder_spec.rsplit("/", 1)
        return folder.strip(), version.strip()
    return folder_spec.strip(), "1"


def fetch_sidecar_sha256(sidecar_url: str) -> str:
    """GET <archive_url>.sha256, parse '<hash>  <filename>', return 64-hex hash.

    Raises on HTTP error or malformed sidecar.
    """
    resp = httpx.get(sidecar_url, timeout=30.0, follow_redirects=True)
    resp.raise_for_status()
    # Standard format: "<64-hex>  <filename>\n" — split()[0] handles one/two-space variants
    line = resp.text.strip()
    sha256_hex = line.split()[0]
    # WR-03: use an explicit raise rather than `assert`. Asserts are stripped when
    # the interpreter runs with -O / PYTHONOPTIMIZE=1, which would silently disable
    # this security-relevant length check on a malformed/attacker-supplied sidecar.
    if len(sha256_hex) != 64:
        raise ValueError(f"Malformed sidecar (expected 64-hex hash): {repr(line)}")
    return sha256_hex


def download_and_verify(url: str, tmp_path: Path, expected_sha256: str) -> bool:
    """Stream download to tmp_path, computing SHA256 inline. Return True iff match.

    On mismatch, tmp_path is removed — the model volume is never touched (D-11/T-20-01).
    """
    h = hashlib.sha256()
    with httpx.stream("GET", url, timeout=600.0, follow_redirects=True) as resp:
        resp.raise_for_status()
        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_bytes(chunk_size=65536):
                f.write(chunk)
                h.update(chunk)
    actual = h.hexdigest()
    if actual != expected_sha256:
        tmp_path.unlink(missing_ok=True)
        return False
    return True


def is_already_installed(folder_name: str, expected_sha256: str) -> bool:
    """Check MODEL_REPO_PATH/{folder_name}/.installed-sha256 marker equality (D-13)."""
    marker = MODEL_REPO_PATH / folder_name / ".installed-sha256"
    if not marker.exists():
        return False
    return marker.read_text().strip() == expected_sha256


def write_installed_marker(folder_name: str, sha256_hex: str) -> None:
    """Write MODEL_REPO_PATH/{folder_name}/.installed-sha256 plain-text file (D-13)."""
    marker = MODEL_REPO_PATH / folder_name / ".installed-sha256"
    marker.write_text(sha256_hex + "\n")


def validate_onnx_path(model_onnx: Path) -> tuple[bool, str]:
    """Run onnx.checker.check_model(str(path)) on a model.onnx file (D-12).

    Skip if absent (ensemble or tokenizer). Return (ok, reason).
    Always uses path string — not a loaded object — to avoid OOM on large models.
    """
    if not model_onnx.exists():
        return True, "no model.onnx (ensemble or tokenizer)"
    try:
        # Use path string (not object) for large models > 2 GB (RESEARCH §Pitfall 3)
        onnx.checker.check_model(str(model_onnx))
        return True, "ok"
    except onnx.checker.ValidationError as e:
        return False, f"onnx.checker: {e}"
    except Exception as e:
        return False, f"unexpected: {e}"


def validate_onnx_if_present(folder_name: str) -> tuple[bool, str]:
    """Validate root model.onnx for a folder via onnx.checker (D-12)."""
    return validate_onnx_path(MODEL_REPO_PATH / folder_name / "1" / "model.onnx")


def print_error_summary(errors: list[ArtifactError]) -> None:
    """Emit a fixed-width table of all errors at the end of main() (D-15)."""
    if not errors:
        return
    logger.error("=" * 60)
    logger.error("ARTIFACT FAILURE SUMMARY")
    logger.error("=" * 60)
    logger.error(f"{'Folder':<35} {'Stage':<20} {'Cause'}")
    logger.error("-" * 80)
    for e in errors:
        logger.error(f"{e.folder:<35} {e.stage:<20} {e.cause}")


def extract_archive(archive_path: Path, extraction_root: Path) -> bool:
    """Extract tar.gz archive to extraction_root with path-traversal filtering (T-20-06).

    Args:
        archive_path: Path to the tar.gz archive
        extraction_root: Directory to extract to (should be MODEL_REPO_PATH)

    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f"Extracting {archive_path} to {extraction_root}")
        with tarfile.open(archive_path, "r:gz") as tar:
            # Security: reject absolute paths, ../ traversal, symlinks/hardlinks,
            # and non-regular members (T-20-06, CR-01). Model archives only contain
            # regular files and directories — any link or device entry is malicious
            # or malformed.
            safe_members = []
            for m in tar.getmembers():
                # Reject absolute paths and ../ in member name
                if m.name.startswith("/") or ".." in Path(m.name).parts:
                    logger.error("Rejecting unsafe tar member name: %r", m.name)
                    return False
                # Reject symlinks and hardlinks entirely — linkname could escape
                # the extraction root even when m.name itself is safe.
                if m.issym() or m.islnk():
                    logger.error(
                        "Rejecting link member: %r -> %r", m.name, m.linkname
                    )
                    return False
                # Reject device files, FIFOs, etc. — only regular files and dirs allowed.
                if not (m.isreg() or m.isdir()):
                    logger.error(
                        "Rejecting non-regular member: %r (type=%r)", m.name, m.type
                    )
                    return False
                safe_members.append(m)
            tar.extractall(path=extraction_root, members=safe_members)

        extracted_files = list(extraction_root.rglob("*"))
        logger.info(f"Extracted {len(extracted_files)} files to {extraction_root}")
        return True
    except Exception as e:
        logger.error(f"Failed to extract archive {archive_path}: {e}")
        return False


def load_model_manifest(manifest_path: Path) -> List[Tuple[str, str]]:
    """Load (folder, url) pairs from a JSON manifest file.

    Schema: {"version": "v1", "downloads": [{"name": str, "url": str}, ...]}.
    """
    import json

    if not manifest_path.is_file():
        logger.error(f"Model manifest not found at {manifest_path}")
        logger.error(
            "Set MODEL_MANIFEST_PATH to a readable JSON manifest"
            " (default /etc/protifer/models.json)."
        )
        sys.exit(1)

    try:
        data = json.loads(manifest_path.read_text())
    except json.JSONDecodeError as e:
        logger.error(f"Model manifest at {manifest_path} is not valid JSON: {e}")
        sys.exit(1)

    if not isinstance(data, dict) or "downloads" not in data:
        logger.error(
            f"Model manifest at {manifest_path} must be an object with a 'downloads' array"
        )
        sys.exit(1)

    entries = data["downloads"]
    if not isinstance(entries, list) or not entries:
        logger.error(f"Model manifest at {manifest_path} has no 'downloads' entries")
        sys.exit(1)

    downloads: List[Tuple[str, str]] = []
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            logger.error(f"Manifest entry {i} is not an object: {entry!r}")
            sys.exit(1)
        name = entry.get("name")
        url = entry.get("url")
        if not isinstance(name, str) or not name:
            logger.error(f"Manifest entry {i} missing or empty 'name'")
            sys.exit(1)
        if not isinstance(url, str) or not url:
            logger.error(f"Manifest entry {i} ({name}) missing or empty 'url'")
            sys.exit(1)
        downloads.append((name, url))
    return downloads


def _default_manifest_path() -> Path:
    return Path("/etc/protifer/models.json")


def fetch_manifest_to_temp(url: str) -> Path:
    """Fetch the JSON manifest from a URL over HTTPS to a temp file.

    Follows redirects (GitHub's `latest/download` and asset URLs both redirect).
    On any HTTP/network failure, exits non-zero with a message naming
    MODEL_MANIFEST_URL — the URL path keeps the file path's loud-fail contract.
    Returns the temp file path holding the manifest body.
    """
    fd, tmp_name = tempfile.mkstemp(suffix=".json", prefix="models-manifest-")
    tmp_path = Path(tmp_name)
    try:
        resp = httpx.get(url, timeout=60.0, follow_redirects=True)
        resp.raise_for_status()
        with os.fdopen(fd, "wb") as f:
            f.write(resp.content)
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        logger.error(f"Failed to fetch model manifest from MODEL_MANIFEST_URL ({url}): {e}")
        sys.exit(1)
    return tmp_path


def parse_model_downloads() -> List[Tuple[str, str]]:
    """Resolve the list of (folder, url) pairs from the JSON manifest.

    Precedence: MODEL_MANIFEST_URL (fetched over HTTPS) wins when set; otherwise
    the local MODEL_MANIFEST_PATH (default /etc/protifer/models.json) is used.
    """
    manifest_url = os.getenv("MODEL_MANIFEST_URL")
    if manifest_url:
        logger.info(f"Fetching model manifest from MODEL_MANIFEST_URL: {manifest_url}")
        tmp_path = fetch_manifest_to_temp(manifest_url)
        try:
            downloads = load_model_manifest(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)
        source = manifest_url
    else:
        manifest_env = os.getenv("MODEL_MANIFEST_PATH")
        manifest_path = Path(manifest_env) if manifest_env else _default_manifest_path()
        downloads = load_model_manifest(manifest_path)
        source = str(manifest_path)

    logger.info(f"Loaded {len(downloads)} downloads from manifest {source}")
    for folder, url in downloads:
        logger.info(f"  {folder} -> {url}")
    return downloads


def download_model(url: str, output_path: Path) -> bool:
    """Download a model from a URL with progress tracking and validation.

    Args:
        url: URL to download from
        output_path: Local path to save the file

    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f"Downloading {url} to {output_path}")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Download to temporary file first (atomic write)
        temp_path = output_path.with_suffix(output_path.suffix + ".tmp")

        with httpx.stream("GET", url, timeout=300.0, follow_redirects=True) as response:
            response.raise_for_status()

            # Log response headers for debugging
            logger.debug(f"Response headers for {url}:")
            for key, value in response.headers.items():
                logger.debug(f"  {key}: {value}")

            total_size = int(response.headers.get("content-length", 0))
            if total_size == 0:
                logger.warning(f"No content-length header for {url}")

            bytes_written = 0
            with open(temp_path, "wb") as f, tqdm(
                desc=output_path.name,
                total=total_size if total_size > 0 else None,
                unit="B",
                unit_scale=True,
                unit_divisor=1024,
            ) as pbar:
                for chunk in response.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    bytes_written += len(chunk)
                    pbar.update(len(chunk))

            logger.info(f"Downloaded {bytes_written} bytes to {temp_path}")
            if total_size > 0 and bytes_written != total_size:
                logger.warning(f"Size mismatch: expected {total_size}, got {bytes_written}")

        # Validate the downloaded file via onnx.checker by path (D-12)
        logger.info(
            f"Validating downloaded file: {temp_path} (size: {temp_path.stat().st_size} bytes)"
        )
        ok, reason = validate_onnx_path(temp_path)
        if not ok:
            logger.error(f"ONNX checker failed for {temp_path}: {reason}")
            # Log some debug information about the file
            try:
                with open(temp_path, "rb") as f:
                    first_bytes = f.read(32)
                    logger.error(f"File validation failed. First 32 bytes: {first_bytes.hex()}")
                    logger.error(f"First 32 bytes as text: {first_bytes}")
            except Exception as e:
                logger.error(f"Could not read file for debugging: {e}")
            temp_path.unlink(missing_ok=True)
            return False

        # Atomic move to final location
        temp_path.rename(output_path)
        logger.info(f"Successfully downloaded {url} to {output_path}")
        return True

    except httpx.TimeoutException:
        logger.error(f"Timeout downloading {url}")
        return False
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error downloading {url}: {e.response.status_code}")
        return False
    except Exception as e:
        logger.error(f"Failed to download {url}: {e}")
        return False


def download_to_folder(folder_spec: str, url: str) -> bool:
    """Download a model to a specific folder.

    For archive URLs (.tar.gz):
    - Phase 20: archive path uses folder_name only; version comes from inside the archive.
    - Fetches .sha256 sidecar, verifies before extraction (D-11).
    - Uses .installed-sha256 marker for idempotence (D-13).
    - Extracts to MODEL_REPO_PATH (not version subdir) — archives are rooted at {folder_name}/.
    - Runs onnx.checker after extraction (D-12).

    For single ONNX files:
    - Downloads to {folder}/{version}/model.onnx (legacy non-archive path).

    Args:
        folder_spec: Folder specification (e.g., "tmbed/1", "prott5_sec")
        url: URL to download from

    Returns:
        True if successful, False otherwise
    """
    folder_name, version = parse_folder_spec(folder_spec)
    target_dir = MODEL_REPO_PATH / folder_name / version

    if is_archive_url(url):
        # Download and extract archive
        logger.info(f"Processing archive for {folder_spec} from {url}")

        # Fetch sidecar SHA256 (D-11) — retry up to 3 times.
        # WR-02: catch any Exception (ConnectError, RemoteProtocolError, IndexError,
        # ValueError from malformed sidecars, etc.) so transient/parse failures
        # still get retried rather than bubbling out to main()'s bare except.
        expected_sha256 = None
        sidecar_url = url + ".sha256"
        for attempt in range(3):
            try:
                expected_sha256 = fetch_sidecar_sha256(sidecar_url)
                break
            except Exception as e:
                if attempt == 2:
                    logger.error(f"Failed to fetch sidecar for {folder_name}: {e}")
                    return False
                logger.warning(
                    f"Sidecar fetch failed for {folder_name} (attempt {attempt + 1}): {e}"
                )
                time.sleep(2**attempt)  # 2s, 4s backoff
        if expected_sha256 is None:
            return False

        # Check idempotence marker (D-13) — skip if already installed with same SHA
        if is_already_installed(folder_name, expected_sha256):
            logger.info("Skipping %s (marker matches)", folder_name)
            return True

        # Download to /tmp (NOT the model volume — T-20-01)
        archive_path = Path("/tmp") / f"{folder_name}.tar.gz"

        # Download with SHA256 verification — retry up to 3 times.
        # WR-02: catch any Exception (ConnectError, RemoteProtocolError, disk I/O
        # errors, etc.) so transient failures get retried instead of escaping to
        # main()'s bare except with zero retries.
        verified = False
        for attempt in range(3):
            try:
                verified = download_and_verify(url, archive_path, expected_sha256)
                if verified:
                    break
                # SHA mismatch — archive already unlinked by download_and_verify
                if attempt == 2:
                    logger.error(f"SHA256 mismatch for {folder_name} after {attempt + 1} attempts")
                    return False
                logger.warning(f"SHA mismatch for {folder_name}, retrying (attempt {attempt + 1})")
                time.sleep(2**attempt)
            except Exception as e:
                if attempt == 2:
                    logger.error(f"Download failed for {folder_name}: {e}")
                    archive_path.unlink(missing_ok=True)
                    return False
                logger.warning(
                    f"Download failed for {folder_name} (attempt {attempt + 1}): {e}"
                )
                time.sleep(2**attempt)

        if not verified:
            archive_path.unlink(missing_ok=True)
            return False

        # Extract archive to MODEL_REPO_PATH (not target_dir) — this is the load-bearing bug fix.
        # Archives are rooted at {folder_name}/, so extracting to MODEL_REPO_PATH produces
        # MODEL_REPO_PATH/{folder_name}/config.pbtxt and MODEL_REPO_PATH/{folder_name}/1/...
        # Extracting to target_dir (MODEL_REPO_PATH/{folder}/{version}) would double-nest.
        if not extract_archive(archive_path, MODEL_REPO_PATH):
            archive_path.unlink(missing_ok=True)
            return False

        # Clean up archive from /tmp
        archive_path.unlink(missing_ok=True)

        # Validate ONNX if present (D-12) — skips for ensembles and tokenizers
        ok, reason = validate_onnx_if_present(folder_name)
        if not ok:
            logger.error(f"ONNX checker failed for {folder_name}: {reason}")
            return False
        logger.info(f"ONNX checker: {folder_name} — {reason}")

        # Write idempotence marker only on full success (D-13)
        write_installed_marker(folder_name, expected_sha256)
        logger.info(f"Successfully extracted archive to {MODEL_REPO_PATH}/{folder_name}")
        return True
    else:
        # Download single ONNX file
        model_path = target_dir / "model.onnx"

        # Check if already exists and is valid
        if model_path.exists() and validate_onnx_path(model_path)[0]:
            logger.info(f"Model {folder_spec} already exists and is valid at {model_path}")
            return True

        logger.info(f"Downloading single file for {folder_spec} from {url}")
        return download_model(url, model_path)


def preflight_nvidia() -> None:
    """Hard-fail if REQUIRE_NVIDIA=true and nvidia-smi is absent or errors.

    Phase 22 D-18: prod default REQUIRE_NVIDIA=true → hard-fails when NVIDIA
    Container Toolkit is missing (nvidia-smi not in PATH) or when nvidia-smi
    returns a non-zero exit. Staging default REQUIRE_NVIDIA=false → skips the
    check so Triton can fall back to CPU execution providers via KIND_AUTO.
    """
    if os.getenv("REQUIRE_NVIDIA", "false").lower() != "true":
        logger.info("REQUIRE_NVIDIA=false — skipping NVIDIA preflight (CPU staging)")
        return
    if shutil.which("nvidia-smi") is None:
        logger.error(
            "REQUIRE_NVIDIA=true but nvidia-smi not in PATH — NVIDIA Container Toolkit likely missing"
        )
        sys.exit(2)
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        logger.error(
            "REQUIRE_NVIDIA=true but nvidia-smi failed: rc=%d stderr=%s",
            result.returncode, result.stderr.strip(),
        )
        sys.exit(2)
    logger.info("NVIDIA preflight OK — GPUs: %s", result.stdout.strip())


def stage_execution_env() -> None:
    """Copy the baked CPU conda-pack env into the shared /models volume.

    Idempotent: skips when the destination already matches the source size
    (the env is version-locked to this image), else writes atomically via a
    temp file + rename so a concurrent Triton load never sees a partial tarball.
    """
    if not EXECUTION_ENV_SRC.is_file():
        logger.warning(
            "Execution env tarball absent at %s — skipping staging", EXECUTION_ENV_SRC
        )
        return
    src_size = EXECUTION_ENV_SRC.stat().st_size
    if EXECUTION_ENV_DEST.exists() and EXECUTION_ENV_DEST.stat().st_size == src_size:
        logger.info("Execution env already staged at %s — skipping", EXECUTION_ENV_DEST)
        return
    EXECUTION_ENV_DEST.parent.mkdir(parents=True, exist_ok=True)
    tmp_dest = EXECUTION_ENV_DEST.with_suffix(EXECUTION_ENV_DEST.suffix + ".tmp")
    shutil.copyfile(EXECUTION_ENV_SRC, tmp_dest)
    tmp_dest.rename(EXECUTION_ENV_DEST)
    logger.info("Staged execution env → %s (%d bytes)", EXECUTION_ENV_DEST, src_size)


def main() -> int:
    """Main initialization function.

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    logger.info("Starting Triton model repository initialization...")
    preflight_nvidia()
    logger.info(f"Model repository path: {MODEL_REPO_PATH}")

    stage_execution_env()

    # Parse environment variables
    downloads = parse_model_downloads()

    # Best-effort processing: attempt all artifacts, collect errors (D-15)
    errors: list[ArtifactError] = []

    for folder_spec, url in downloads:
        folder_name, _ = parse_folder_spec(folder_spec)
        try:
            if download_to_folder(folder_spec, url):
                logger.info(f"Successfully processed {folder_spec}")
            else:
                # download_to_folder returns False for expected failures (SHA mismatch, etc.)
                # Classify based on what stage was likely reached
                errors.append(
                    ArtifactError(
                        folder=folder_name,
                        stage="download",
                        cause="download_to_folder returned False — see logs above",
                    )
                )
                logger.error(f"Failed to process {folder_spec}")
        except Exception as e:
            errors.append(
                ArtifactError(
                    folder=folder_name,
                    stage="download",
                    cause=str(e),
                )
            )
            logger.error(f"Unexpected error processing {folder_spec}: {e}")

    # Print error summary table (D-15)
    print_error_summary(errors)

    if errors:
        return 1

    logger.info("Model download successful!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
