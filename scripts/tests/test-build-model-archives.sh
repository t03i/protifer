#!/usr/bin/env bash
# Determinism regression test: build archive twice, assert identical SHA256.
# Usage: bash scripts/tests/test-build-model-archives.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Use seth — smallest real model with only config.pbtxt (no ONNX required).
# If config.pbtxt is absent (gitignored), skip gracefully so CI stays green.
TEST_FOLDER="seth"
if [ ! -f "$REPO_ROOT/model-repository/${TEST_FOLDER}/config.pbtxt" ]; then
    echo "SKIP: ${TEST_FOLDER}/config.pbtxt absent — determinism test requires tracked files"
    exit 0
fi

DIST1="$(mktemp -d)"
DIST2="$(mktemp -d)"
trap 'rm -rf "$DIST1" "$DIST2"' EXIT

python3 "$REPO_ROOT/scripts/build-model-archives.py" \
    --folders "$TEST_FOLDER" \
    --version 1 \
    --output "$DIST1"

python3 "$REPO_ROOT/scripts/build-model-archives.py" \
    --folders "$TEST_FOLDER" \
    --version 1 \
    --output "$DIST2"

SHA1=$(sha256sum "$DIST1/${TEST_FOLDER}-v1.tar.gz" | awk '{print $1}')
SHA2=$(sha256sum "$DIST2/${TEST_FOLDER}-v1.tar.gz" | awk '{print $1}')

if [ "$SHA1" != "$SHA2" ]; then
    echo "FAIL: non-deterministic archive — SHA256 differs between runs"
    echo "  Run 1: $SHA1"
    echo "  Run 2: $SHA2"
    exit 1
fi
echo "PASS: deterministic archive SHA256=$SHA1"
