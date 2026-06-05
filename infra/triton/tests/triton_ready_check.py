#!/usr/bin/env python3
"""T2 — per-model load + ready + unload against a running Triton (CPU).

Reads the model list from the manifest at MODEL_MANIFEST_URL, then for each
model: loads it via the explicit model-control API, polls
`GET /v2/models/<name>/ready` until 200 (bounded timeout), and unloads it
before the next (memory-bounded, design D5). Fails if any manifest model does
not reach READY (design D6 — no quarantine list). Issues no inference request.

Env:
  TRITON_URL           base URL of the running server (e.g. http://127.0.0.1:8000)
  MODEL_MANIFEST_URL   release manifest URL (same one the init container used)
  READY_TIMEOUT_S      per-model ready timeout (default 300)
"""
import os
import sys
import time

import httpx

TRITON = os.environ["TRITON_URL"].rstrip("/")
MANIFEST_URL = os.environ["MODEL_MANIFEST_URL"]
READY_TIMEOUT_S = int(os.getenv("READY_TIMEOUT_S", "300"))


def model_names() -> list[str]:
    resp = httpx.get(MANIFEST_URL, timeout=60.0, follow_redirects=True)
    resp.raise_for_status()
    downloads = resp.json()["downloads"]
    # name may be a folder_spec like "tmbed/1" — the repo folder is the part
    # before the slash, which is also the Triton model name.
    return [d["name"].split("/", 1)[0] for d in downloads]


def wait_ready(name: str) -> bool:
    deadline = time.monotonic() + READY_TIMEOUT_S
    while time.monotonic() < deadline:
        r = httpx.get(f"{TRITON}/v2/models/{name}/ready", timeout=30.0)
        if r.status_code == 200:
            return True
        time.sleep(3)
    return False


def main() -> int:
    names = model_names()
    print(f"Manifest lists {len(names)} models: {', '.join(names)}")
    failed: list[str] = []
    for name in names:
        print(f"--- loading {name}")
        load = httpx.post(f"{TRITON}/v2/repository/models/{name}/load", timeout=600.0)
        if load.status_code != 200 or not wait_ready(name):
            print(f"FAIL: {name} did not reach READY (load HTTP {load.status_code})")
            failed.append(name)
            continue
        print(f"OK: {name} READY")
        httpx.post(f"{TRITON}/v2/repository/models/{name}/unload", timeout=120.0)

    if failed:
        print(f"\n{len(failed)} model(s) failed to reach READY: {', '.join(failed)}")
        return 1
    print(f"\nAll {len(names)} manifest models reached READY (no inference issued).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
