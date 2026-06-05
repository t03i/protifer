#!/usr/bin/env bash
# Parity guard: --verify-manifest passes for a complete manifest and fails when
# a required ensemble step (e.g. _tmbed_viterbi) is missing.
# Usage: bash scripts/tests/test-manifest-parity.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if ! ls "$REPO_ROOT/model-repository"/*/config.pbtxt >/dev/null 2>&1; then
    echo "SKIP: no model-repository/*/config.pbtxt present — parity test requires tracked configs"
    exit 0
fi

BUILD="$REPO_ROOT/scripts/build-model-archives.py"
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

# Canonical folder set mirrored from build-model-archives.py V14_FOLDERS (22 folders).
NAMES=(
    _internal_prott5_onnx _internal_prott5_tokenizer prot_t5_pipeline tmbed bind_embed
    _tmbed_cv0 _tmbed_cv1 _tmbed_cv2 _tmbed_cv3 _tmbed_cv4 _tmbed_viterbi
    _bind_embed_cv0 _bind_embed_cv1 _bind_embed_cv2 _bind_embed_cv3 _bind_embed_cv4
    vespag seth prott5_cons prott5_sec light_attention_membrane light_attention_subcell
)

write_manifest() {
    local out="$1"; shift
    {
        printf '{\n  "version": "v1",\n  "downloads": [\n'
        local first=1
        for n in "$@"; do
            [ "$first" -eq 1 ] && first=0 || printf ',\n'
            printf '    { "name": "%s", "url": "https://example/%s-v1.tar.gz" }' "$n" "$n"
        done
        printf '\n  ]\n}\n'
    } > "$out"
}

# Complete manifest — all 22 names — must pass.
GOOD="$FIXTURES/good.json"
write_manifest "$GOOD" "${NAMES[@]}"
if ! python3 "$BUILD" --verify-manifest "$GOOD"; then
    echo "FAIL: complete manifest rejected"
    exit 1
fi

# Manifest missing _tmbed_viterbi — must fail non-zero.
BAD="$FIXTURES/bad.json"
MISSING=()
for n in "${NAMES[@]}"; do
    [ "$n" = "_tmbed_viterbi" ] && continue
    MISSING+=("$n")
done
write_manifest "$BAD" "${MISSING[@]}"
if python3 "$BUILD" --verify-manifest "$BAD"; then
    echo "FAIL: manifest missing _tmbed_viterbi was accepted"
    exit 1
fi

echo "PASS: manifest parity guard accepts complete set, rejects missing _tmbed_viterbi"
