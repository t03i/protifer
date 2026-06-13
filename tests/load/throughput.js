// Throughput baseline (pro plan, 5 VUs, 3 minutes, collect-only).
// Each iteration submits a UNIQUE random sequence so the run measures real Triton
// inference, not the hash-keyed, immutable S3 cache-hit path — a fixed input becomes
// a permanent cache hit after its first run and would under-report true cost. Length
// is fixed (LOAD_TEST_SEQ_LENGTH, default 350) so per-run compute stays comparable for
// trending. Set LOAD_TEST_CACHED=true for a cheap gateway-only run on a fixed accession.
// Baseline metrics captured via `--out json=...` in nightly.yml; no latency/throughput thresholds.

import http from 'k6/http'
import { check } from 'k6'
import { randomSequence } from './sequences.js'

const BASE_URL = __ENV.PROD_GATEWAY_URL || 'http://localhost:3001'
const API_KEY = __ENV.LOAD_TEST_PRO_BEARER || ''
const USE_CACHED = __ENV.LOAD_TEST_CACHED === 'true'
const SEQ_LENGTH = Number(__ENV.LOAD_TEST_SEQ_LENGTH || 350)

export const options = {
  vus: 5,
  duration: '3m',
  thresholds: {
    // Hard gate: <1% network errors or 5xx. k6 counts 4xx/5xx as failures by
    // default; 429s are excluded via responseCallback below so this catches only real failures.
    http_req_failed: ['rate<0.01'],
  },
  // No latency threshold — this is a collect-only baseline run.
}

// Guard: prevent accidental CI runs without credentials.
// K6_SMOKE=true bypasses this for local syntax validation.
export function setup() {
  if (!API_KEY && __ENV.K6_SMOKE !== 'true') {
    throw new Error(
      'LOAD_TEST_PRO_BEARER is not set. ' +
        'Pass it via -e LOAD_TEST_PRO_BEARER=<key> or set K6_SMOKE=true for syntax-only smoke runs.',
    )
  }
}

export default function () {
  // Unique sequence per request → cache miss → real inference; fixed length keeps runs comparable.
  const body = USE_CACHED
    ? JSON.stringify({ accession: 'P04637' })
    : JSON.stringify({ sequence: randomSequence(SEQ_LENGTH) })
  const res = http.post(`${BASE_URL}/v1/predictions`, body, {
    headers: {
      'Content-Type': 'application/json',
      // Bearer auth via the better-auth apiKey plugin — resolves to the
      // pro-plan user the key was minted for.
      Authorization: `Bearer ${API_KEY}`,
    },
    // Treat 2xx–4xx as non-failures so 429s don't inflate http_req_failed.
    responseCallback: http.expectedStatuses({ min: 200, max: 499 }),
  })

  // Only check that no 5xx occurred — 429 responses are acceptable on a baseline run
  check(res, {
    'no 5xx': (r) => r.status < 500,
  })
}
