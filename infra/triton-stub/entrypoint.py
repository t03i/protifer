#!/usr/bin/env python3
"""
Container entrypoint for the dev/CI stub Triton.

At boot, derives a python-backed stub model-repository from the real one (mounted
read-only at STUB_SRC_REPO, default /src) into STUB_MODEL_REPO (default /models),
then execs `tritonserver`. Per source model:

  ensemble (platform: "ensemble")  -> config.pbtxt copied as-is (the gRPC contract)
  leaf (backend: onnxruntime|python) -> backend rewritten to "python";
                                      EXECUTION_ENV_PATH parameters block and
                                      default_model_filename stripped;
                                      identity_model.py dropped into 1/model.py
  _deferred/*                      -> skipped

Extra args after the script are forwarded to tritonserver.
"""
import os
import re
import shutil
import sys
from pathlib import Path

SKIP_PREFIX = "_deferred"


def classify(config_text):
    """'ensemble' if the config declares the ensemble platform, else 'leaf'."""
    return (
        "ensemble"
        if re.search(r'^\s*platform:\s*"ensemble"', config_text, re.M)
        else "leaf"
    )


def _start_with_leading_comments(text, block_start):
    """Index from which the contiguous comment lines (`# ...`) immediately
    preceding `block_start` begin, so a removed block takes its comment with it."""
    line_start = text.rfind("\n", 0, block_start) + 1
    while line_start > 0:
        prev_line_start = text.rfind("\n", 0, line_start - 1) + 1
        if not text[prev_line_start:line_start].strip().startswith("#"):
            break
        line_start = prev_line_start
    return line_start


def strip_parameters_blocks_containing(text, needle):
    """Remove top-level `parameters: { ... }` blocks whose body contains `needle`,
    matching braces so nested `{ ... }` are handled, plus the introducing comment."""
    marker = "parameters:"
    result = []
    cursor = 0
    while cursor < len(text):
        start = text.find(marker, cursor)
        if start == -1:
            result.append(text[cursor:])
            break
        brace = text.find("{", start)
        if brace == -1:
            result.append(text[cursor:])
            break

        depth = 0
        end = brace
        while end < len(text):
            ch = text[end]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end += 1
                    break
            end += 1

        if needle in text[start:end]:
            keep_until = _start_with_leading_comments(text, start)
            result.append(text[cursor:keep_until])
            cursor = end + 1 if end < len(text) and text[end] == "\n" else end
        else:
            result.append(text[cursor:end])
            cursor = end
    return "".join(result)


def transform_leaf(config_text):
    """Rewrite a leaf config so a python identity stub can serve it, preserving the
    input/output tensor contract (names, dtypes, dims) — surgical text edits only."""
    out = re.sub(r'backend:\s*"[^"]*"', 'backend: "python"', config_text, count=1)
    out = re.sub(
        r'^[ \t]*default_model_filename:\s*"[^"]*"[ \t]*\r?\n',
        "",
        out,
        count=1,
        flags=re.M,
    )
    out = strip_parameters_blocks_containing(out, "EXECUTION_ENV_PATH")
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.rstrip() + "\n"


def build_repo(src, dst, identity_model):
    """Derive the stub repo at `dst` from the real repo at `src`. Returns
    (ensembles, leaves) for logging."""
    src, dst, identity_model = Path(src), Path(dst), Path(identity_model)
    # Clear dst's *contents*, not dst itself: in the container it's a tmpfs
    # mountpoint, and rmdir'ing a mountpoint fails with EBUSY.
    dst.mkdir(parents=True, exist_ok=True)
    for entry in dst.iterdir():
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()

    ensembles, leaves = [], []
    for entry in sorted(src.iterdir()):
        if entry.name.startswith(SKIP_PREFIX) or not entry.is_dir():
            continue
        config = entry / "config.pbtxt"
        if not config.exists():
            continue

        text = config.read_text()
        out_dir = dst / entry.name
        (out_dir / "1").mkdir(parents=True)

        if classify(text) == "ensemble":
            (out_dir / "config.pbtxt").write_text(text)
            ensembles.append(entry.name)
        else:
            (out_dir / "config.pbtxt").write_text(transform_leaf(text))
            shutil.copyfile(identity_model, out_dir / "1" / "model.py")
            leaves.append(entry.name)

    return ensembles, leaves


def main(argv):
    src = os.environ.get("STUB_SRC_REPO", "/src")
    dst = os.environ.get("STUB_MODEL_REPO", "/models")
    identity = Path(__file__).resolve().with_name("identity_model.py")

    ensembles, leaves = build_repo(src, dst, identity)
    print(
        f"triton-stub: derived {len(ensembles)} ensembles + {len(leaves)} leaves "
        f"from {src} into {dst}",
        flush=True,
    )

    args = [
        "tritonserver",
        f"--model-repository={dst}",
        "--disable-auto-complete-config",
        *argv,
    ]
    os.execvp("tritonserver", args)


if __name__ == "__main__":
    main(sys.argv[1:])
