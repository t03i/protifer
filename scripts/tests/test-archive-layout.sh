#!/usr/bin/env bash
# Assert archive root layout: {folder_name}/config.pbtxt and {folder_name}/1/ present.
# Double-nesting sentinel: {folder_name}/1/{folder_name}/ must NOT exist.
# Usage: bash scripts/tests/test-archive-layout.sh <path-to-archive.tar.gz>
set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <archive.tar.gz>"
    exit 1
fi

ARCHIVE="$1"

if [ ! -f "$ARCHIVE" ]; then
    echo "FAIL: archive not found: $ARCHIVE"
    exit 1
fi

FOLDER_NAME=$(tar -tzf "$ARCHIVE" | head -1 | cut -d'/' -f1)

if ! tar -tzf "$ARCHIVE" | grep -q "^${FOLDER_NAME}/config\\.pbtxt$"; then
    echo "FAIL: archive missing ${FOLDER_NAME}/config.pbtxt"
    exit 1
fi

if ! tar -tzf "$ARCHIVE" | grep -q "^${FOLDER_NAME}/1/"; then
    echo "FAIL: archive missing ${FOLDER_NAME}/1/ version subdirectory"
    exit 1
fi

# Double-nesting sentinel: must NOT contain {folder_name}/1/{folder_name}/
if tar -tzf "$ARCHIVE" | grep -q "^${FOLDER_NAME}/1/${FOLDER_NAME}/"; then
    echo "FAIL: double-nesting detected — archive contains ${FOLDER_NAME}/1/${FOLDER_NAME}/"
    exit 1
fi

echo "PASS: $ARCHIVE layout correct (root=${FOLDER_NAME}/)"
