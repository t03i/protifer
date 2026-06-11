#!/usr/bin/env bash
# Compose + slim the dev/CI triton-stub image: a real `tritonserver` -py3-min with
# the python backend spliced in, then the GPU runtime (CUDA toolkit, TensorRT, cuDNN,
# NCCL, DCGM cuBLAS proxies, Nsight) stripped out and the result flattened to a single
# layer. A CPU python identity backend NEEDs none of that — only libcudart,
# libdcgm.so.3 and libicudata, all kept — so the pushed image drops from ~7.4 GB to
# ~0.8 GB compressed and the backend-e2e pull goes from ~5 min to ~40 s.
#
# entrypoint.py / identity_model.py are NOT baked in — they are mounted at runtime —
# so this image changes ONLY on a Triton version bump. Shared by
# .github/workflows/{ci,triton-stub}.yml and runnable by hand. The caller must
# `docker login ghcr.io` first when PUSH=1.
#
# Usage: VERSION=25.06 [IMAGE=ghcr.io/t03i/protifer-triton-stub] [PUSH=1] infra/triton-stub/build.sh
set -euo pipefail

VERSION="${VERSION:?set VERSION (Triton tag, e.g. 25.06 — MUST match the production Triton tag)}"
IMAGE="${IMAGE:-ghcr.io/t03i/protifer-triton-stub}"
PUSH="${PUSH:-0}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Always linux/amd64: prod Triton and CI runners are amd64. On an arm64 host this
# cross-builds under emulation; compose.py is COPY-heavy and `docker import` honours
# this, so the flattened image is stamped amd64 regardless of host.
export DOCKER_DEFAULT_PLATFORM=linux/amd64

fat_tag="triton-stub-fat:${VERSION}"
strip_ctr="triton-stub-strip-$$"
smoke_ctr="triton-stub-smoke-$$"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir";
      docker rm -f "$strip_ctr" "$smoke_ctr" >/dev/null 2>&1 || true;
      docker rmi "$fat_tag" >/dev/null 2>&1 || true' EXIT

git clone --depth 1 --branch "r${VERSION}" \
  https://github.com/triton-inference-server/server.git "${workdir}/server"
cd "${workdir}/server"

# compose.py imports build.py, which needs these at module load.
python3 -m pip install --quiet --disable-pip-version-check distro requests

# compose.py pulls the full (~11 GB) and min (~6 GB) images to extract the python
# backend, then emits the fat (~20 GB) image we slim below.
python3 compose.py \
  --backend python \
  --image "full,nvcr.io/nvidia/tritonserver:${VERSION}-py3" \
  --image "min,nvcr.io/nvidia/tritonserver:${VERSION}-py3-min" \
  --output-name "${fat_tag}"

# Drop the GPU runtime a CPU python identity backend never loads. tritonserver and
# libtriton_python NEED only libcudart, libdcgm.so.3 and libicudata (all kept);
# everything removed here is dlopen'd solely by GPU backends, which are gone. The
# first find clears CUDA toolkit extras (Nsight, compat, nvvm, ...) keeping `targets`,
# the second keeps only libcudart within it.
docker run --name "${strip_ctr}" --entrypoint sh "${fat_tag}" -euc '
  find /usr/local/cuda-* -mindepth 1 -maxdepth 1 ! -name targets -exec rm -rf {} + ;
  find /usr/local/cuda-*/targets/*/lib -type f ! -name "libcudart.so*" -delete ;
  rm -rf /lib/x86_64-linux-gnu/libnvinfer* \
         /lib/x86_64-linux-gnu/libcudnn* \
         /lib/x86_64-linux-gnu/libnccl* \
         /lib/x86_64-linux-gnu/libdcgm_cublas_proxy* \
         /lib/x86_64-linux-gnu/libnvperf* \
         /lib/x86_64-linux-gnu/libcupti* ;
  ldconfig
'

# Flatten to one layer (a plain rm only adds a whiteout — the registry still ships the
# fat layers underneath). export|import discards the image config, so carry the base
# config (env incl. spaces, entrypoint, workdir, user) forward verbatim as --change.
docker inspect "${fat_tag}" --format '{{json .Config}}' > "${workdir}/config.json"
changes=()
while IFS= read -r -d '' tok; do changes+=("$tok"); done < <(python3 -c '
import json, sys
c = json.load(open(sys.argv[1]))
out = []
def emit(instr): out.extend(("--change", instr))
for e in c.get("Env") or []:
    k, _, v = e.partition("=")
    v = v.replace("\\", "\\\\").replace("\"", "\\\"")
    emit(f"ENV {k}=\"{v}\"")
if c.get("Entrypoint"): emit("ENTRYPOINT " + json.dumps(c["Entrypoint"]))
if c.get("Cmd"):        emit("CMD " + json.dumps(c["Cmd"]))
if c.get("WorkingDir"): emit("WORKDIR " + c["WorkingDir"])
if c.get("User"):       emit("USER " + c["User"])
sys.stdout.write("".join(t + "\0" for t in out))
' "${workdir}/config.json")
docker export "${strip_ctr}" | docker import "${changes[@]}" - "${IMAGE}:${VERSION}"

docker image ls "${IMAGE}"

# Smoke test: the slimmed image must still boot the python backend and serve over the
# real KServe contract, exercised exactly as the compose stacks run it (real
# entrypoint.py deriving the repo from a synthetic source).
mkdir -p "${workdir}/src/smoke/1"
cat > "${workdir}/src/smoke/config.pbtxt" <<'CFG'
name: "smoke"
backend: "onnxruntime"
max_batch_size: 4
input [ { name: "x" data_type: TYPE_FP32 dims: [ 8 ] } ]
output [ { name: "y" data_type: TYPE_FP32 dims: [ 4 ] } ]
CFG
docker run -d --name "${smoke_ctr}" \
  -e STUB_SRC_REPO=/src -e STUB_MODEL_REPO=/models --tmpfs /models \
  -v "${workdir}/src":/src:ro \
  -v "${here}/entrypoint.py":/opt/triton-stub/entrypoint.py:ro \
  -v "${here}/identity_model.py":/opt/triton-stub/identity_model.py:ro \
  "${IMAGE}:${VERSION}" \
  python3 /opt/triton-stub/entrypoint.py >/dev/null

echo "smoke: waiting for the slim stub to report the model READY..."
ready=""
for _ in $(seq 1 40); do
  if docker exec "${smoke_ctr}" python3 -c \
      'import urllib.request, sys; sys.exit(0 if urllib.request.urlopen("http://localhost:8000/v2/models/smoke/ready").status == 200 else 1)' \
      >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 3
done
if [ -z "${ready}" ]; then
  echo "smoke FAILED: slim stub did not become ready — refusing to push" >&2
  docker logs "${smoke_ctr}" 2>&1 | tail -40 >&2
  exit 1
fi
echo "smoke OK: slim stub booted and the model is READY"

if [ "${PUSH}" = "1" ]; then
  docker push "${IMAGE}:${VERSION}"
fi
