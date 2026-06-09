#!/usr/bin/env bash
set -euo pipefail

BASE="${GARAGE_ADMIN_URL:-http://garage:3903}"
ADMIN="$BASE/v2"
TOKEN="${GARAGE_ADMIN_TOKEN:-}"
KEY_ID="${GARAGE_KEY_ID:-GK000000000000000000000000}"
KEY_SECRET="${GARAGE_KEY_SECRET:-0000000000000000000000000000000000000000000000000000000000000000}"
BUCKET="${GARAGE_BUCKET:-embeddings}"
# Advertised layout capacity in bytes (default 10 GiB for local dev; prod sets
# this higher via GARAGE_LAYOUT_CAPACITY to match the host pool).
LAYOUT_CAPACITY="${GARAGE_LAYOUT_CAPACITY:-10737418240}"

AUTH=()
if [ -n "$TOKEN" ]; then
  AUTH=(-H "Authorization: Bearer $TOKEN")
fi

# Emit the actual reason garage is unreachable. A bare "Not ready"/"Timed out"
# hides the common failure on proxied hosts: a corporate proxy injected into the
# container env captures the request to the bare service name `garage` (no
# NO_PROXY match, not a literal IP) and can't resolve a compose-internal name.
# Surface curl's real error + the effective proxy env so the cause is obvious.
diagnose_unreachable() {
  echo "  --- diagnostics: cannot reach garage admin API ---" >&2
  echo "  GARAGE_ADMIN_URL=$BASE" >&2
  echo "  curl says:" >&2
  curl -sS -o /dev/null "$BASE/health" 2>&1 | sed 's/^/    /' >&2 || true
  if env | grep -qiE '^(http|https|no)_proxy='; then
    echo "  proxy env in this container (may be hijacking the request):" >&2
    env | grep -iE '^(http|https|no)_proxy=' | sed 's/^/    /' >&2
    echo "  if the proxy is capturing 'garage', clear *_proxy for this container" >&2
    echo "  or add the service name to NO_PROXY (see deploy-repo proxy runbook)." >&2
  else
    echo "  no proxy env set — garage likely not up yet or wrong GARAGE_ADMIN_URL." >&2
  fi
}

# --- 1. Wait for admin API ---
echo "→ Waiting for garage admin API..."
ATTEMPTS=0
MAX_ATTEMPTS=30  # 30 × 2s = 60s max
until curl -sf "$BASE/health" > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "  Timed out waiting for garage after $((MAX_ATTEMPTS * 2))s" >&2
    diagnose_unreachable
    exit 1
  fi
  echo "  Not ready (attempt $ATTEMPTS/$MAX_ATTEMPTS), retrying in 2s..."
  sleep 2
done
echo "  OK"

# --- 2. Assign and apply cluster layout ---
echo "→ Checking cluster layout..."
LAYOUT_BODY=$(curl -s "${AUTH[@]}" "$ADMIN/GetClusterLayout")
LAYOUT_HTTP=$(curl -o /dev/null -s -w "%{http_code}" "${AUTH[@]}" "$ADMIN/GetClusterLayout")
LAYOUT_VERSION=0

if [ "$LAYOUT_HTTP" = "200" ]; then
  LAYOUT_VERSION=$(echo "$LAYOUT_BODY" | jq '.version // 0')
elif [ "$LAYOUT_HTTP" = "404" ]; then
  LAYOUT_VERSION=0  # no layout yet — proceed to assign
else
  echo "  Unexpected HTTP $LAYOUT_HTTP from layout endpoint:" >&2
  echo "$LAYOUT_BODY" >&2
  exit 1
fi

if [ "$LAYOUT_VERSION" -eq 0 ]; then
  echo "  Layout not applied — assigning node..."
  NODE_BODY=$(curl -sf "${AUTH[@]}" "$ADMIN/GetClusterStatus")
  NODE_ID=$(echo "$NODE_BODY" | jq -r '.nodes[0].id // empty')
  if [ -z "$NODE_ID" ]; then
    echo "  Cannot determine node ID. Response: $NODE_BODY" >&2
    exit 1
  fi
  echo "  Node ID: $NODE_ID"

  # Body must be {"roles": [...]} — UpdateClusterLayoutRequest is a struct, not a bare array
  # Field name is "id" (not "nodeId") per NodeRoleChange struct definition
  # capacity = advertised layout capacity in bytes (a relative weight for data
  # placement, NOT a hard usage cap; grow the underlying pool to add real space).
  # Driven by GARAGE_LAYOUT_CAPACITY (default 10 GiB dev / set to 300 GiB in prod).
  # Only applied on the FIRST layout assignment; an already-applied layout must
  # be resized manually (garage layout assign -c <size> <node-id> && layout apply).
  LAYOUT_BODY=$(jq -n --arg id "$NODE_ID" --argjson cap "$LAYOUT_CAPACITY" \
    '{"roles": [{"id": $id, "zone": "dc1", "capacity": $cap, "tags": []}]}')
  curl -sf -X POST "${AUTH[@]}" "$ADMIN/UpdateClusterLayout" \
    -H "Content-Type: application/json" \
    -d "$LAYOUT_BODY" \
    > /dev/null

  # Apply with version = current staged version + 1
  STAGED_VERSION=$(curl -sf "${AUTH[@]}" "$ADMIN/GetClusterLayout" | jq '.version + 1')
  echo "→ Applying layout (version $STAGED_VERSION)..."
  curl -sf -X POST "${AUTH[@]}" "$ADMIN/ApplyClusterLayout" \
    -H "Content-Type: application/json" \
    -d "{\"version\":$STAGED_VERSION}" \
    > /dev/null
  echo "  Layout applied."
else
  echo "  Layout already at version $LAYOUT_VERSION, skipping."
fi

# --- 3. Create bucket ---
echo "→ Checking bucket '$BUCKET'..."
BUCKET_HTTP=$(curl -o /dev/null -s -w "%{http_code}" "${AUTH[@]}" "$ADMIN/GetBucketInfo?globalAlias=$BUCKET")

if [ "$BUCKET_HTTP" = "200" ]; then
  BUCKET_ID=$(curl -sf "${AUTH[@]}" "$ADMIN/GetBucketInfo?globalAlias=$BUCKET" | jq -r '.id')
  echo "  Bucket already exists: $BUCKET_ID"
elif [ "$BUCKET_HTTP" = "404" ]; then
  echo "  Bucket not found — creating..."
  BUCKET_ID=$(curl -sf -X POST "${AUTH[@]}" "$ADMIN/CreateBucket" \
    -H "Content-Type: application/json" \
    -d "{\"globalAlias\":\"$BUCKET\"}" | jq -r '.id')
  echo "  Bucket created: $BUCKET_ID"
else
  echo "  Unexpected HTTP $BUCKET_HTTP checking bucket" >&2
  exit 1
fi

# --- 4. Import access key with deterministic ID ---
echo "→ Checking access key '$KEY_ID'..."
KEY_HTTP=$(curl -o /dev/null -s -w "%{http_code}" "${AUTH[@]}" "$ADMIN/GetKeyInfo?id=$KEY_ID")

if [ "$KEY_HTTP" = "404" ]; then
  echo "  Key not found — importing..."
  curl -sf -X POST "${AUTH[@]}" "$ADMIN/ImportKey" \
    -H "Content-Type: application/json" \
    -d "{\"accessKeyId\":\"$KEY_ID\",\"secretAccessKey\":\"$KEY_SECRET\",\"name\":\"dev-key\"}" \
    > /dev/null
  echo "  Key imported."
elif [ "$KEY_HTTP" = "200" ]; then
  echo "  Key already exists, skipping."
else
  echo "  Unexpected HTTP $KEY_HTTP checking key" >&2
  exit 1
fi

# --- 5. Grant bucket access (idempotent by Garage) ---
echo "→ Granting key access to bucket..."
curl -sf -X POST "${AUTH[@]}" "$ADMIN/AllowBucketKey" \
  -H "Content-Type: application/json" \
  -d "{\"bucketId\":\"$BUCKET_ID\",\"accessKeyId\":\"$KEY_ID\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":false}}" \
  > /dev/null
echo "  Access granted."

echo ""
echo "✓ Garage initialization complete."
echo "  Bucket: $BUCKET ($BUCKET_ID)"
echo "  Key ID: $KEY_ID"
