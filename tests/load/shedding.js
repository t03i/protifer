// Shedding calibration scenario — drives POST /v1/predictions above sustainable
// GPU throughput with mixed sequence lengths so the admission controller's EWMA
// settles into its steady-state window.
//
// Run against a fully-up stack (mock Triton or real GPU) with `SHED_ENABLED=true`
// and `SHED_MODE=shadow`: it inspects what the controller *would* have shed without
// surfacing 503 to clients, so operators can compare `requests_shed_total` against
// `bullmq_queue_jobs`.
//
// Recommended invocation:
//   k6 run -e LOAD_TEST_PRO_BEARER=$KEY tests/load/shedding.js
//
// During the run:
//   watch -n 5 'curl -s http://localhost:3001/metrics | grep -E "^shedding_|^requests_shed_total"'
//
// After the run, read `shedding_residues_per_second` during the
// steady-state window and set `SHED_INITIAL_RESIDUES_PER_SECOND` to
// ~70-80% of the observed value.

import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.PROD_GATEWAY_URL || 'http://localhost:3001'
const API_KEY = __ENV.LOAD_TEST_PRO_BEARER || ''

// Mixed length profile — small peptides, typical single-chain proteins,
// and long sequences bracketing the 4096 MAX_SEQUENCE_LENGTH ceiling.
const SEQUENCES = [
  'A'.repeat(50), // peptide
  'A'.repeat(300), // UniProt median-ish
  'A'.repeat(1024), // large globular
  'A'.repeat(3500), // near the max
]

export const options = {
  stages: [
    { duration: '30s', target: 15 },
    { duration: '5m', target: 15 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Tolerate 503s (that's the point); fail only on real network errors.
    http_req_failed: ['rate<0.05'],
  },
}

export function setup() {
  if (!API_KEY && __ENV.K6_SMOKE !== 'true') {
    throw new Error(
      'LOAD_TEST_PRO_BEARER is not set. ' +
        'Pass it via -e LOAD_TEST_PRO_BEARER=<key> or set K6_SMOKE=true for syntax-only smoke runs.',
    )
  }
}

export default function () {
  const sequence = SEQUENCES[Math.floor(Math.random() * SEQUENCES.length)]
  const res = http.post(
    `${BASE_URL}/v1/predictions`,
    JSON.stringify({ sequence }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      responseCallback: http.expectedStatuses({ min: 200, max: 599 }),
    },
  )
  check(res, {
    '2xx/4xx/5xx handled': (r) => r.status > 0,
    'no network error': (r) => r.error === '',
  })
  sleep(Math.random() * 0.25)
}
