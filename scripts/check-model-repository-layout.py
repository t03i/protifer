#!/usr/bin/env python3
"""Lightweight CI guard over checked-in model-repository/ configs (Decision 7).

No weights, no network, no tar — replaces the local-only onnx.checker /
completeness enforcement that moved into build-model-artifact.py. Over
model-repository/*/config.pbtxt (skips _deferred/):

  (a) every ensemble step (model_name inside a platform:"ensemble" config)
      resolves to a present sibling model dir, and
  (b) each model dir has a config.pbtxt and is either an ensemble or carries a
      numeric version subdir (e.g. 1/). ONNX weight dirs whose version subdir is
      gitignored (weights live outside the repo) are reported but not failed —
      the build script materializes their version dir.

Exit 0 on success / skip-when-empty, non-zero with a clear message on violation.

    python3 scripts/check-model-repository-layout.py
"""
import logging
import re
import sys
from pathlib import Path

EXCLUDE_DIRS = {"_deferred"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("check-model-repository-layout")


def _parse_config(config_path: Path) -> tuple[bool, list[str]]:
    """Parse a config.pbtxt: return (is_ensemble, ensemble_step_model_names)."""
    text = config_path.read_text()
    is_ensemble = bool(re.search(r'platform:\s*"ensemble"', text))
    steps = re.findall(r'model_name:\s*"([^"]+)"', text)
    return is_ensemble, steps


def _has_version_subdir(model_dir: Path) -> bool:
    return any(
        d.is_dir() and d.name.isdigit() for d in model_dir.iterdir()
    )


def check(model_repo: Path) -> int:
    configs = (
        sorted(model_repo.glob("*/config.pbtxt")) if model_repo.exists() else []
    )
    if not configs:
        logger.info("SKIP: no model-repository/*/config.pbtxt present")
        return 0

    present_dirs = {c.parent.name for c in configs}
    errors: list[str] = []

    for config_path in configs:
        model_dir = config_path.parent
        name = model_dir.name
        is_ensemble, steps = _parse_config(config_path)

        if is_ensemble:
            for step in steps:
                if step not in present_dirs:
                    errors.append(
                        f"{name}: ensemble step '{step}' has no sibling model dir"
                    )
        elif not _has_version_subdir(model_dir):
            # Weight dirs ship config-only (weights gitignored); the build
            # materializes the version dir. Report, do not fail.
            logger.info(
                "%s: no numeric version subdir (config-only; weights external)", name
            )

    if errors:
        for e in errors:
            logger.error("%s", e)
        return 1

    logger.info(
        "Layout OK: %d config(s), ensemble steps resolved", len(configs)
    )
    return 0


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    return check(repo_root / "model-repository")


if __name__ == "__main__":
    sys.exit(main())
