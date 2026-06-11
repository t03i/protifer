#!/usr/bin/env bash
# Compose the dev/CI triton-stub image: a real `tritonserver` -py3-min with the
# python backend spliced in (no GPU, no weights). entrypoint.py / identity_model.py
# are NOT baked in — they are mounted at runtime — so this image changes ONLY on a
# Triton version bump. Shared by .github/workflows/{ci,triton-stub}.yml and runnable
# by hand. The caller must `docker login ghcr.io` first when PUSH=1.
#
# Usage: VERSION=25.06 [IMAGE=ghcr.io/t03i/protifer-triton-stub] [PUSH=1] infra/triton-stub/build.sh
set -euo pipefail

VERSION="${VERSION:?set VERSION (Triton tag, e.g. 25.06 — MUST match the production Triton tag)}"
IMAGE="${IMAGE:-ghcr.io/t03i/protifer-triton-stub}"
PUSH="${PUSH:-0}"

# Always linux/amd64: prod Triton and CI runners are amd64. On an arm64 host this
# cross-builds under emulation; compose.py is COPY-heavy so the overhead is small.
export DOCKER_DEFAULT_PLATFORM=linux/amd64

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

git clone --depth 1 --branch "r${VERSION}" \
  https://github.com/triton-inference-server/server.git "${workdir}/server"
cd "${workdir}/server"

# compose.py imports build.py, which needs these at module load.
python3 -m pip install --quiet --disable-pip-version-check distro requests

# compose.py pulls the full (~11 GB) and min (~6 GB) images to extract the python
# backend, then emits IMAGE:VERSION.
python3 compose.py \
  --backend python \
  --image "full,nvcr.io/nvidia/tritonserver:${VERSION}-py3" \
  --image "min,nvcr.io/nvidia/tritonserver:${VERSION}-py3-min" \
  --output-name "${IMAGE}:${VERSION}"

docker image ls "${IMAGE}"

if [ "${PUSH}" = "1" ]; then
  docker push "${IMAGE}:${VERSION}"
fi
