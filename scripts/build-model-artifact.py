#!/usr/bin/env python3
"""Build + push the /models tree as an OCI artifact (per-file content-addressed).

Producer for the idempotent-model-deploy change (design Decisions 1/1b/4/5/7).
Assembles model-repository/ configs + external ONNX weights + a linux/amd64
conda-pack env into a staging tree, validates ONNX, derives per-model
content-version, then `oras push`es each file as its own uncompressed blob plus a
typed inventory config blob. Prints the immutable digest for the deploy repo to
pin.

Stdlib + subprocess to `docker` and `oras`. `onnx` imported lazily (only the
checker path needs it).

    python3 scripts/build-model-artifact.py --org <org> --weights-root /weights
    python3 scripts/build-model-artifact.py --dry-run        # print oras push only
"""
import argparse
import hashlib
import json
import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INVENTORY_MEDIA_TYPE = "application/vnd.protifer.model-inventory.v1+json"
ARTIFACT_TYPE = "application/vnd.protifer.model-repo.v1"
DEFAULT_ORG = "<org>"
DEFAULT_REPO = "model-repo"
DEFAULT_IMAGE_SOURCE = "https://github.com/t03i/protifer"
DEFAULT_IMAGE_LICENSES = "Apache-2.0"
DEFAULT_IMAGE_DESCRIPTION = "protifer Triton model repository (OCI artifact)"
ENV_DOCKERFILE = Path("infra/triton/Dockerfile.modelenv")
ENV_TARBALL_REL = "_envs/cpu_py312.tar.gz"
ENV_TARBALL_IN_IMAGE = "/opt/protifer/cpu_py312.tar.gz"

EXCLUDE_NAMES = {"__pycache__", ".DS_Store", ".gitkeep", ".gitignore", ".installed-sha256"}
EXCLUDE_SUFFIXES = {".pyc", ".md"}
EXCLUDE_DIRS = {"_deferred"}

# id <-> triton <-> role mapping. Anything absent here (vespag, all underscore-
# prefixed internal dirs) is role "internal" with no gateway id.
MODEL_MAP: dict[str, dict[str, str]] = {
    "prot_t5_pipeline": {"id": "prott5_xl_u50", "role": "embedding"},
    "prott5_sec": {"id": "prott5_secondary_structure", "role": "prediction"},
    "tmbed": {"id": "tmbed", "role": "prediction"},
    "seth": {"id": "seth", "role": "prediction"},
    "bind_embed": {"id": "bindembed", "role": "prediction"},
    "prott5_cons": {"id": "prott5_conservation", "role": "prediction"},
    "light_attention_subcell": {"id": "light_attention_subcellular", "role": "prediction"},
    "light_attention_membrane": {"id": "light_attention_membrane", "role": "prediction"},
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("build-model-artifact")


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------


def should_exclude(file_path: Path) -> bool:
    return (
        file_path.name in EXCLUDE_NAMES
        or file_path.suffix in EXCLUDE_SUFFIXES
        or "__pycache__" in file_path.parts
    )


def model_dirs(model_repo: Path) -> list[Path]:
    """Top-level model dirs under model-repository/ (skips _deferred)."""
    return sorted(
        d
        for d in model_repo.iterdir()
        if d.is_dir() and d.name not in EXCLUDE_DIRS
    )


def stage_configs(model_repo: Path, staging: Path) -> None:
    """Copy the config-only tree from model-repository/ into staging."""
    for src in sorted(model_repo.rglob("*")):
        if src.is_dir():
            continue
        if EXCLUDE_DIRS.intersection(src.relative_to(model_repo).parts):
            continue
        if should_exclude(src):
            continue
        dst = staging / src.relative_to(model_repo)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def overlay_weights(weights_root: Path | None, staging: Path) -> int:
    """Overlay external weight files (matching the staging layout) into staging.

    weights_root mirrors the model-repository layout (e.g.
    <root>/tmbed/1/model.onnx). Returns the count of overlaid files.
    """
    if weights_root is None:
        logger.info("No --weights-root given; staging tree is config-only.")
        return 0
    count = 0
    for src in sorted(weights_root.rglob("*")):
        if src.is_dir() or should_exclude(src):
            continue
        rel = src.relative_to(weights_root)
        if EXCLUDE_DIRS.intersection(rel.parts):
            continue
        dst = staging / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        count += 1
    logger.info("Overlaid %d weight file(s) from %s", count, weights_root)
    return count


# ---------------------------------------------------------------------------
# Conda env (linux/amd64 docker stage, cached by Dockerfile hash)
# ---------------------------------------------------------------------------


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_conda_env(
    repo_root: Path, staging: Path, cache_dir: Path, *, no_cache: bool
) -> None:
    """Build cpu_py312.tar.gz in a linux/amd64 docker stage; stage under _envs/.

    Cached by the env Dockerfile's content hash so weight-only rebuilds reuse the
    identical blob (Decisions 5/1b).
    """
    dockerfile = repo_root / ENV_DOCKERFILE
    if not dockerfile.exists():
        raise FileNotFoundError(f"env Dockerfile not found: {dockerfile}")

    key = _file_sha256(dockerfile)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"cpu_py312-{key}.tar.gz"
    staged = staging / ENV_TARBALL_REL
    staged.parent.mkdir(parents=True, exist_ok=True)

    if cached.exists() and not no_cache:
        logger.info("Conda env cache hit: %s", cached.name)
        shutil.copy2(cached, staged)
        return

    logger.info("Building conda env (linux/amd64) from %s", dockerfile)
    tag = f"protifer-modelenv:{key[:12]}"
    subprocess.run(
        [
            "docker", "build",
            "--platform=linux/amd64",
            "-f", str(dockerfile),
            "-t", tag,
            str(dockerfile.parent),
        ],
        check=True,
    )
    # Extract the produced tarball from the built image.
    cid = subprocess.run(
        ["docker", "create", "--platform=linux/amd64", tag],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    try:
        subprocess.run(
            ["docker", "cp", f"{cid}:{ENV_TARBALL_IN_IMAGE}", str(cached)],
            check=True,
        )
    finally:
        subprocess.run(["docker", "rm", "-f", cid], check=False, capture_output=True)

    shutil.copy2(cached, staged)
    logger.info("Conda env built and cached: %s", cached.name)


# ---------------------------------------------------------------------------
# ONNX validation
# ---------------------------------------------------------------------------


def check_onnx(staging: Path) -> None:
    """Run onnx.checker over every */1/model.onnx by path-string (avoids OOM).

    Raises on the first structural error.
    """
    models = sorted(staging.glob("*/1/model.onnx"))
    if not models:
        logger.info("No */1/model.onnx present; skipping ONNX checks (config-only).")
        return
    import onnx  # lazy: keep --help / dry paths import-free

    for m in models:
        logger.info("onnx.checker: %s", m.relative_to(staging))
        try:
            onnx.checker.check_model(str(m))
        except onnx.checker.ValidationError as e:
            raise RuntimeError(f"onnx.checker failed for {m}: {e}") from e


# ---------------------------------------------------------------------------
# Per-model content version + inventory
# ---------------------------------------------------------------------------


def model_dir_version(model_dir: Path) -> str:
    """sha256 over the model dir: sorted relative paths + file bytes (deterministic)."""
    h = hashlib.sha256()
    for f in sorted(p for p in model_dir.rglob("*") if p.is_file()):
        rel = f.relative_to(model_dir).as_posix()
        h.update(rel.encode())
        h.update(b"\0")
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


def build_inventory(staging: Path) -> dict:
    """Assemble the typed inventory config blob from the staged tree."""
    models = []
    for d in model_dirs(staging):
        # _envs is a staged tree dir, not a model.
        if d.name == "_envs":
            continue
        if not (d / "config.pbtxt").exists():
            continue
        mapping = MODEL_MAP.get(d.name)
        role = mapping["role"] if mapping else "internal"
        entry: dict = {"triton": d.name}
        if mapping:
            entry["id"] = mapping["id"]
        entry["role"] = role
        entry["version"] = model_dir_version(d)
        models.append(entry)
    models.sort(key=lambda e: e["triton"])
    return {"models": models}


# ---------------------------------------------------------------------------
# oras push
# ---------------------------------------------------------------------------


def collect_blobs(staging: Path) -> list[str]:
    """oras file args: '<relpath>:<mediaType>' for every staged file.

    Relative paths preserve the tree layout (oras stores them in the title
    annotation; `oras pull` reconstructs the directory).
    """
    args = []
    for f in sorted(p for p in staging.rglob("*") if p.is_file()):
        rel = f.relative_to(staging).as_posix()
        args.append(rel)
    return args


def build_push_cmd(
    ref: str, config_path: Path, blob_args: list[str], annotations: dict[str, str]
) -> list[str]:
    annotation_args = []
    for key, value in annotations.items():
        if value:
            annotation_args += ["--annotation", f"{key}={value}"]
    return [
        "oras", "push", ref,
        "--artifact-type", ARTIFACT_TYPE,
        "--config", f"{config_path}:{INVENTORY_MEDIA_TYPE}",
        *annotation_args,
        *blob_args,
    ]


def fetch_digest(ref: str) -> str | None:
    """Resolve the pushed manifest digest via `oras manifest fetch --descriptor`."""
    try:
        out = subprocess.run(
            ["oras", "manifest", "fetch", "--descriptor", ref],
            check=True, capture_output=True, text=True,
        ).stdout
        return json.loads(out).get("digest")
    except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
        logger.warning("Could not resolve digest for %s: %s", ref, exc)
        return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build + push /models as an OCI artifact (per-file content-addressed).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Pushes to ghcr.io/<org>/model-repo by default (override --org/--repo/--tag).

Examples:
  # Config-only build pushed to a placeholder org (dry-run prints the command)
  python3 scripts/build-model-artifact.py --dry-run

  # Full build with external weights overlaid, real org/tag
  python3 scripts/build-model-artifact.py --org acme --weights-root /weights --tag latest
""",
    )
    parser.add_argument("--org", default=DEFAULT_ORG, help=f"GHCR org (default: {DEFAULT_ORG})")
    parser.add_argument("--repo", default=DEFAULT_REPO, help=f"Repo name (default: {DEFAULT_REPO})")
    parser.add_argument("--tag", default="latest", help="Push tag (default: latest)")
    parser.add_argument(
        "--image-source",
        default=DEFAULT_IMAGE_SOURCE,
        help=f"org.opencontainers.image.source annotation (default: {DEFAULT_IMAGE_SOURCE}).",
    )
    parser.add_argument(
        "--image-licenses",
        default=DEFAULT_IMAGE_LICENSES,
        help=f"org.opencontainers.image.licenses annotation (default: {DEFAULT_IMAGE_LICENSES}).",
    )
    parser.add_argument(
        "--image-description",
        default=DEFAULT_IMAGE_DESCRIPTION,
        help="org.opencontainers.image.description annotation.",
    )
    parser.add_argument(
        "--weights-root",
        default=None,
        help="Root of external ONNX weights mirroring the model-repository layout.",
    )
    parser.add_argument(
        "--repo-root",
        default=None,
        help="Repository root (default: auto-detect from script location).",
    )
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Conda-env tarball cache dir (default: <repo-root>/.cache/model-env).",
    )
    parser.add_argument(
        "--no-cache", action="store_true", help="Force a conda-env rebuild."
    )
    parser.add_argument(
        "--skip-env",
        action="store_true",
        help="Skip building the conda env (configs-only artifact; debugging).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Assemble + validate, then print the oras push command without executing.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    repo_root = (
        Path(args.repo_root).resolve()
        if args.repo_root
        else Path(__file__).resolve().parent.parent
    )
    model_repo = repo_root / "model-repository"
    if not model_repo.exists():
        logger.error("model-repository/ not found at %s", model_repo)
        return 1

    cache_dir = (
        Path(args.cache_dir).resolve()
        if args.cache_dir
        else repo_root / ".cache" / "model-env"
    )
    ref = f"ghcr.io/{args.org}/{args.repo}:{args.tag}"

    with tempfile.TemporaryDirectory(prefix="model-artifact-") as tmp:
        staging = Path(tmp) / "models"
        staging.mkdir(parents=True)

        stage_configs(model_repo, staging)
        overlay_weights(
            Path(args.weights_root).resolve() if args.weights_root else None,
            staging,
        )

        if args.skip_env:
            logger.info("--skip-env: conda env not built.")
        else:
            try:
                build_conda_env(
                    repo_root, staging, cache_dir, no_cache=args.no_cache
                )
            except (subprocess.SubprocessError, FileNotFoundError) as exc:
                logger.error("Conda env build failed: %s", exc)
                return 1

        try:
            check_onnx(staging)
        except RuntimeError as exc:
            logger.error("%s", exc)
            return 1

        inventory = build_inventory(staging)
        logger.info("Inventory: %d model(s)", len(inventory["models"]))

        config_path = Path(tmp) / "inventory.json"
        config_path.write_text(json.dumps(inventory, indent=2) + "\n")

        blob_args = collect_blobs(staging)
        annotations = {
            "org.opencontainers.image.source": args.image_source,
            "org.opencontainers.image.licenses": args.image_licenses,
            "org.opencontainers.image.description": args.image_description,
        }
        cmd = build_push_cmd(ref, config_path, blob_args, annotations)

        if args.dry_run:
            logger.info("Dry run — would push %d blob(s) to %s", len(blob_args), ref)
            # cwd of the real push is the staging dir (relative blob paths).
            print(f"cd {staging} && \\")
            print(" ".join(cmd))
            return 0

        if args.org == DEFAULT_ORG:
            logger.error(
                "Refusing to push to placeholder org %s — pass --org or use --dry-run.",
                DEFAULT_ORG,
            )
            return 1

        logger.info("oras push %d blob(s) → %s", len(blob_args), ref)
        try:
            subprocess.run(cmd, check=True, cwd=str(staging))
        except subprocess.SubprocessError as exc:
            logger.error("oras push failed: %s", exc)
            return 1

    digest = fetch_digest(ref)
    if digest:
        print(f"MODEL_ARTIFACT_REF=ghcr.io/{args.org}/{args.repo}@{digest}")
    else:
        logger.warning("Push succeeded but digest unresolved; query the registry to pin.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
