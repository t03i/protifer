#!/usr/bin/env python3
"""Build deterministic .tar.gz archives from model-repository/ for GitHub Releases.

Usage:
    python scripts/build-model-archives.py --version 1 --output dist/
    python scripts/build-model-archives.py --folders vespag,seth --version 1 --output dist/
    python scripts/build-model-archives.py --generate-notes --commit <sha> --version models-v1.0.0 --output dist/
    python scripts/build-model-archives.py --version 1 --output dist/ --publish models-v1.0.0

Stdlib only — no pip dependencies required.

Security note (T-20-06 path traversal): Archive member names are constructed from
file_path.relative_to(folder_path.parent) where folder_path is anchored under the
repo root, and only regular file entries (no symlinks, no directories) are added.
No operator-supplied path or filename can inject traversal sequences into the archive.
"""
import argparse
import hashlib
import json
import logging
import re
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FIXED_MTIME = 0  # 1970-01-01 epoch — maximally reproducible
COMPRESS_LEVEL = 6  # gzip default; consistent across platforms

EXCLUDE_NAMES = {"__pycache__", ".DS_Store", ".gitkeep", ".installed-sha256"}
EXCLUDE_SUFFIXES = {".pyc", ".md"}

# Canonical folder set (22 folders) — ESM2 excluded per FUT-09 (deferred to future milestone)
V14_FOLDERS = [
    "_internal_prott5_onnx",
    "_internal_prott5_tokenizer",
    "prot_t5_pipeline",
    "tmbed",
    "bind_embed",
    "_tmbed_cv0",
    "_tmbed_cv1",
    "_tmbed_cv2",
    "_tmbed_cv3",
    "_tmbed_cv4",
    "_tmbed_viterbi",
    "_bind_embed_cv0",
    "_bind_embed_cv1",
    "_bind_embed_cv2",
    "_bind_embed_cv3",
    "_bind_embed_cv4",
    "vespag",
    "seth",
    "prott5_cons",
    "prott5_sec",
    "light_attention_membrane",
    "light_attention_subcell",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("build-model-archives")


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------


def should_exclude(file_path: Path) -> bool:
    """Return True if file_path should be omitted from the archive.

    Excluded: __pycache__ dirs/files, *.pyc, .DS_Store, .gitkeep,
    .installed-sha256, *.md files.
    """
    return (
        file_path.name in EXCLUDE_NAMES
        or file_path.suffix in EXCLUDE_SUFFIXES
        or "__pycache__" in file_path.parts
    )


def build_archive(folder_path: Path, output_path: Path) -> tuple[str, int]:
    """Build a deterministic .tar.gz archive from a model folder.

    Archive root is {folder_name}/ so init_models.py can extractall(MODEL_REPO_PATH)
    without path munging. Only regular files are added (no symlinks, no dir entries).

    Security invariant (T-20-06): archive member names derive from
    relative_to(folder_path.parent) where folder_path is under the repo root.
    No externally-supplied name enters the tarball.

    Returns: (sha256_hex, size_bytes)
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tarfile.open(output_path, "w:gz", compresslevel=COMPRESS_LEVEL) as tar:
        for file_path in sorted(folder_path.rglob("*")):
            if file_path.is_dir() or should_exclude(file_path):
                continue
            # Relative to folder_path.parent produces {folder_name}/1/model.onnx
            rel = file_path.relative_to(folder_path.parent)
            ti = tarfile.TarInfo(name=str(rel))
            ti.size = file_path.stat().st_size
            ti.mtime = FIXED_MTIME
            ti.uid = 0
            ti.gid = 0
            ti.uname = ""
            ti.gname = ""
            ti.mode = 0o644
            with open(file_path, "rb") as f:
                tar.addfile(ti, f)

    # Compute SHA256 over the completed archive bytes
    h = hashlib.sha256()
    with open(output_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)

    size_bytes = output_path.stat().st_size
    return h.hexdigest(), size_bytes


def write_sidecar(archive_path: Path, sha256_hex: str) -> Path:
    """Write sha256sum-format sidecar: '<hash>  <filename>\\n' (two spaces)."""
    sidecar_path = Path(str(archive_path) + ".sha256")
    sidecar_path.write_text(f"{sha256_hex}  {archive_path.name}\n")
    return sidecar_path


def generate_manifest(repo: str, tag: str, version: str, folders: list[str]) -> dict:
    """Generate the deploy manifest pointing at this release's archive assets.

    Schema: {"version": "v1", "downloads": [{"name", "url"}, ...]}. Each url is
    deterministic from repo+tag+asset name — no GitHub API round-trip. The
    manifest references its own release (`<tag>`), so it is self-consistent
    however it is later fetched (pinned or latest).
    """
    return {
        "version": f"v{version}",
        "downloads": [
            {
                "name": folder,
                "url": (
                    f"https://github.com/{repo}/releases/download/"
                    f"{tag}/{folder}-v{version}.tar.gz"
                ),
            }
            for folder in folders
        ],
    }


def git_commit_sha(repo_root: Path) -> str:
    """Return current git HEAD SHA, or empty string if unavailable."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return ""


def build_all(
    repo_root: Path,
    folders: list[str],
    version: str,
    output_dir: Path,
) -> tuple[list[dict], list[str]]:
    """Build archives for all requested folders.

    Skips folders with no content (logs INFO). Accumulates per-folder failures.
    Writes dist/checksums.json at the end.

    Returns: (manifest_entries, failures)
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    model_repo = repo_root / "model-repository"

    manifest_entries: list[dict] = []
    failures: list[str] = []

    for folder_name in folders:
        folder_path = model_repo / folder_name
        if not folder_path.exists():
            logger.info("Skipping %s — folder not found in model-repository/", folder_name)
            continue

        # Check the folder has at least one non-excluded file
        trackable_files = [
            p for p in folder_path.rglob("*")
            if not p.is_dir() and not should_exclude(p)
        ]
        if not trackable_files:
            logger.info("Skipping %s — no archivable files found", folder_name)
            continue

        archive_name = f"{folder_name}-v{version}.tar.gz"
        archive_path = output_dir / archive_name

        try:
            sha256_hex, size_bytes = build_archive(folder_path, archive_path)
            write_sidecar(archive_path, sha256_hex)
            logger.info(
                "Built %s (sha256=%s, %d bytes)",
                archive_name,
                sha256_hex,
                size_bytes,
            )
            manifest_entries.append(
                {
                    "name": archive_name,
                    "sha256": sha256_hex,
                    "size_bytes": size_bytes,
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("FAILED %s: %s", folder_name, exc)
            failures.append(f"{folder_name}: {exc}")

    # Write checksums manifest
    commit = git_commit_sha(repo_root)
    manifest = {
        "version": f"models-v{version}",
        "commit": commit,
        "archives": manifest_entries,
    }
    checksums_path = output_dir / "checksums.json"
    checksums_path.write_text(json.dumps(manifest, indent=2) + "\n")
    logger.info("Wrote %s (%d archives)", checksums_path, len(manifest_entries))

    return manifest_entries, failures


def generate_notes(output_dir: Path, version: str, commit: str) -> str:
    """Read checksums.json and emit Markdown release notes to stdout.

    Template from 20-RESEARCH.md §Topic 9.
    """
    checksums_path = output_dir / "checksums.json"
    if not checksums_path.exists():
        logger.error(
            "checksums.json not found at %s — run without --generate-notes first",
            checksums_path,
        )
        return ""

    with open(checksums_path) as f:
        manifest = json.load(f)

    archives = manifest.get("archives", [])
    source_commit = commit or manifest.get("commit", "unknown")
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    archive_count = len(archives)

    lines = [
        f"## {version}",
        "",
        f"**Source commit:** `{source_commit}` (model-repository configs)",
        f"**Published:** {date_str}",
        f"**Archive count:** {archive_count}",
        "",
        "### Asset Checksums",
        "",
        "| Archive | SHA256 |",
        "|---------|--------|",
    ]
    for entry in archives:
        lines.append(f"| `{entry['name']}` | `{entry['sha256']}` |")

    lines += [
        "",
        "### Notes",
        "- All archives contain `config.pbtxt` + version directory for direct Triton volume population.",
        "- SHA256 sidecars (`.sha256` files) match the table above.",
        "- `init_models.py` fetches and verifies sidecars automatically.",
        "",
        f"{archive_count} archives, {archive_count} sidecars. Total assets: {archive_count * 2}.",
    ]

    return "\n".join(lines) + "\n"


def write_verified_manifest(
    output_dir: Path, repo: str, tag: str, version: str, repo_root: Path
) -> Path | None:
    """Write models.v{version}.json self-referencing this release, then verify parity.

    The manifest is built from the canonical folder set, each entry pointing at the
    sibling archive asset in `tag`. Returns the manifest path, or None if the
    folder-set / manifest parity check failed (caller turns that into exit 1).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = generate_manifest(repo, tag=tag, version=version, folders=V14_FOLDERS)
    manifest_path = output_dir / f"models.v{version}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    logger.info("Generated %s (%d entries)", manifest_path, len(manifest["downloads"]))
    if verify_manifest(repo_root, manifest_path) != 0:
        logger.error("Manifest parity check failed for %s", tag)
        return None
    return manifest_path


def publish_release(
    output_dir: Path,
    tag: str,
    repo: str,
    *,
    version: str,
    repo_root: Path,
    draft: bool = False,
) -> int:
    """Create a GitHub Release and upload all built archives from output_dir.

    Requires `gh` CLI authenticated (GH_TOKEN env var or `gh auth login`).
    Uses draft-then-publish so assets are uploaded atomically before the
    release is visible to consumers.

    Generates the parity-checked `models.v{version}.json` and uploads it alongside
    the archives — so the manifest and the archives it lists ship as one immutable
    release.

    Returns 0 on success, 1 on failure.
    """
    repo_flags = ["--repo", repo]

    manifest_path = write_verified_manifest(output_dir, repo, tag, version, repo_root)
    if manifest_path is None:
        return 1

    # Generate notes into a temp file
    notes = generate_notes(output_dir, version=tag, commit=git_commit_sha(output_dir.parent))
    if not notes:
        logger.error("Failed to generate release notes — run build step first")
        return 1

    # WR-01: create notes_path inside the try/finally so early-return paths
    # (e.g. "no assets found") still hit the cleanup block.
    notes_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            f.write(notes)
            notes_path = f.name

        assets = sorted(
            [
                p
                for p in output_dir.iterdir()
                if p.suffix in {".gz", ".sha256"} or p == manifest_path
            ]
        )
        if not assets:
            logger.error("No archives found in %s — run build step first", output_dir)
            return 1

        logger.info("Publishing %s with %d assets...", tag, len(assets))

        # Create draft release with all assets
        create_cmd = [
            "gh", "release", "create", tag,
            "--draft",
            "--title", tag,
            "--notes-file", notes_path,
            *repo_flags,
            *[str(a) for a in assets],
        ]
        result = subprocess.run(create_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("gh release create failed:\n%s", result.stderr)
            return 1
        logger.info("Draft release created: %s", result.stdout.strip())

        # Publish (remove draft flag)
        if not draft:
            edit_cmd = ["gh", "release", "edit", tag, "--draft=false", *repo_flags]
            result = subprocess.run(edit_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error("gh release edit --draft=false failed:\n%s", result.stderr)
                logger.error("Release %s was created as a draft — publish manually with:", tag)
                logger.error("  gh release edit %s --draft=false", tag)
                return 1
            logger.info("Release published: %s", tag)

    finally:
        if notes_path:
            Path(notes_path).unlink(missing_ok=True)

    return 0


def publish_manifest_only(
    output_dir: Path,
    tag: str,
    repo: str,
    *,
    version: str,
    repo_root: Path,
) -> int:
    """Generate + verify the manifest and upload it to an *existing* release.

    Use when the archives are already published under `tag` and only the manifest
    needs to be added (the full --publish path runs `gh release create`, which
    collides with an existing release). Uses `--clobber` so re-runs are idempotent.

    Returns 0 on success, 1 on failure.
    """
    manifest_path = write_verified_manifest(output_dir, repo, tag, version, repo_root)
    if manifest_path is None:
        return 1

    repo_flags = ["--repo", repo]
    cmd = [
        "gh", "release", "upload", tag, str(manifest_path),
        "--clobber", *repo_flags,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("gh release upload failed:\n%s", result.stderr)
        return 1
    logger.info("Uploaded %s to release %s", manifest_path.name, tag)
    return 0


def _parse_config(config_path: Path) -> tuple[bool, list[str]]:
    """Parse a config.pbtxt: return (is_ensemble, ensemble_step_model_names)."""
    text = config_path.read_text()
    is_ensemble = bool(re.search(r'platform:\s*"ensemble"', text))
    steps = re.findall(r'model_name:\s*"([^"]+)"', text)
    return is_ensemble, steps


def verify_manifest(repo_root: Path, manifest_path: Path) -> int:
    """Cross-check the canonical folder set against the model graph and a deploy manifest.

    Operates on config.pbtxt only — no weights required. SKIPs (exit 0) when no
    model-repository configs are present (mirrors the determinism test).

    Asserts:
      1. every ensemble step (model_name in a platform:"ensemble" config) is in V14_FOLDERS, and
      2. V14_FOLDERS equals the manifest's downloads name set.

    Returns 0 on success/skip, 1 on mismatch.
    """
    model_repo = repo_root / "model-repository"
    configs = sorted(model_repo.glob("*/config.pbtxt")) if model_repo.exists() else []
    if not configs:
        logger.info(
            "SKIP: no model-repository/*/config.pbtxt present — cannot verify graph parity"
        )
        return 0

    ensemble_steps: set[str] = set()
    for config_path in configs:
        is_ensemble, steps = _parse_config(config_path)
        if is_ensemble:
            ensemble_steps.update(steps)

    canonical = set(V14_FOLDERS)
    ok = True

    missing_steps = sorted(ensemble_steps - canonical)
    if missing_steps:
        ok = False
        logger.error(
            "Ensemble steps missing from canonical folder set: %s",
            ", ".join(missing_steps),
        )

    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read manifest %s: %s", manifest_path, exc)
        return 1

    manifest_names = {d["name"] for d in manifest.get("downloads", [])}
    only_canonical = sorted(canonical - manifest_names)
    only_manifest = sorted(manifest_names - canonical)
    if only_canonical or only_manifest:
        ok = False
        if only_canonical:
            logger.error("In canonical set but not in manifest: %s", ", ".join(only_canonical))
        if only_manifest:
            logger.error("In manifest but not in canonical set: %s", ", ".join(only_manifest))

    if not ok:
        return 1

    logger.info(
        "Parity OK: %d ensemble steps covered, %d folders match manifest",
        len(ensemble_steps),
        len(canonical),
    )
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build deterministic .tar.gz model archives for GitHub Releases.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Build all v1.4 folders
  python scripts/build-model-archives.py --version 1 --output dist/

  # Build specific folders only
  python scripts/build-model-archives.py --folders vespag,seth --version 1 --output dist/

  # Generate release notes from a prior build's checksums.json
  python scripts/build-model-archives.py --generate-notes --commit deadbeef \\
      --version models-v1.0.0 --output dist/

  # Build and publish a GitHub Release in one step (requires gh auth login)
  python scripts/build-model-archives.py --version 1 --output dist/ --publish models-v1.0.0

  # Same but leave as draft for manual inspection before publishing
  python scripts/build-model-archives.py --version 1 --output dist/ --publish models-v1.0.0 --draft
""",
    )
    parser.add_argument(
        "--folders",
        default=None,
        help=(
            "Comma-separated list of folder names to archive "
            "(default: all 22 canonical folders)"
        ),
    )
    parser.add_argument(
        "--version",
        default="1",
        help=(
            "Model version directory number for archive naming (default: 1). "
            "When used with --generate-notes, accepts release tag strings like 'models-v1.0.0'."
        ),
    )
    parser.add_argument(
        "--output",
        default="dist/",
        help="Output directory for archives, sidecars, and checksums.json (default: dist/)",
    )
    parser.add_argument(
        "--repo-root",
        default=None,
        help="Repository root path (default: auto-detect from script location)",
    )
    parser.add_argument(
        "--generate-notes",
        action="store_true",
        help="Read checksums.json from --output dir and emit Markdown release notes to stdout",
    )
    parser.add_argument(
        "--commit",
        default="",
        help="Git commit SHA to embed in release notes (used with --generate-notes)",
    )
    parser.add_argument(
        "--publish",
        default=None,
        metavar="TAG",
        help=(
            "After building, create a GitHub Release with TAG (e.g. models-v1.0.0) "
            "and upload all archives. Requires gh CLI authenticated."
        ),
    )
    parser.add_argument(
        "--publish-manifest",
        default=None,
        metavar="TAG",
        help=(
            "Generate + verify the manifest and upload it to an EXISTING release TAG "
            "(via `gh release upload --clobber`). Use when archives are already "
            "published and only models.v<version>.json needs adding."
        ),
    )
    parser.add_argument(
        "--repo",
        default=None,
        help=(
            "GitHub repo (owner/name) that hosts the release assets and manifest URLs. "
            "REQUIRED with --publish / --publish-manifest — there is no git-remote "
            "fallback, so the release target is always explicit."
        ),
    )
    parser.add_argument(
        "--draft",
        action="store_true",
        help="With --publish: leave the release as a draft instead of publishing it.",
    )
    parser.add_argument(
        "--verify-manifest",
        default=None,
        metavar="PATH",
        help=(
            "Verify the canonical folder set covers every ensemble step and equals "
            "the deploy manifest's downloads names. Exits non-zero on mismatch."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Resolve repo root
    if args.repo_root:
        repo_root = Path(args.repo_root).resolve()
    else:
        repo_root = Path(__file__).resolve().parent.parent

    output_dir = Path(args.output).resolve()

    # The publish paths bake --repo into the manifest download URLs and the
    # release target. Require it explicitly — never silently inherit the repo
    # from `git remote origin`, which would point the manifest at whatever clone
    # happens to run the command.
    if (args.publish or args.publish_manifest) and not args.repo:
        logger.error(
            "--repo owner/name is required with --publish / --publish-manifest"
            " (no git-remote fallback — pass the release repo explicitly)"
        )
        return 1

    if args.generate_notes:
        notes = generate_notes(output_dir, version=args.version, commit=args.commit)
        if not notes:
            return 1
        print(notes, end="")
        return 0

    if args.verify_manifest:
        return verify_manifest(repo_root, Path(args.verify_manifest).resolve())

    if args.publish_manifest:
        return publish_manifest_only(
            output_dir=output_dir,
            tag=args.publish_manifest,
            repo=args.repo,
            version=args.version,
            repo_root=repo_root,
        )

    # Resolve folder list
    if args.folders:
        folders = [f.strip() for f in args.folders.split(",") if f.strip()]
    else:
        folders = list(V14_FOLDERS)

    _entries, failures = build_all(
        repo_root=repo_root,
        folders=folders,
        version=args.version,
        output_dir=output_dir,
    )

    if failures:
        logger.error("%d archive(s) failed:", len(failures))
        for msg in failures:
            logger.error("  %s", msg)
        return 1

    if args.publish:
        return publish_release(
            output_dir=output_dir,
            tag=args.publish,
            repo=args.repo,
            version=args.version,
            repo_root=repo_root,
            draft=args.draft,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
