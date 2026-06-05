// Rate limiter enforcement (free plan, 20 VUs, 30s).
// Do not `bun add k6`; run via `k6 run tests/load/rate-limiter.js` (Go binary).

import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'

const rateLimitedCount = new Counter('rate_limited_count')
const fivexxCount = new Counter('fivexx_count')

const BASE_URL = __ENV.PROD_GATEWAY_URL || 'http://localhost:3001'
const API_KEY = __ENV.LOAD_TEST_FREE_BEARER || ''

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    // The free-plan cap (10 req/min) MUST be hit — confirms rate limiter is active
    rate_limited_count: ['count>0'],
    // No server errors allowed — a 5xx means the service is broken, not just rate-limited
    fivexx_count: ['count==0'],
  },
}

// Guard: prevent accidental CI runs without credentials.
// K6_SMOKE=true bypasses this for local syntax validation (Task 4).
export function setup() {
  if (!API_KEY && __ENV.K6_SMOKE !== 'true') {
    throw new Error(
      'LOAD_TEST_FREE_BEARER is not set. ' +
        'Pass it via -e LOAD_TEST_FREE_BEARER=<key> or set K6_SMOKE=true for syntax-only smoke runs.',
    )
  }
}

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/predictions`,
    JSON.stringify({ accession: 'P04637' }),
    {
      headers: {
        'Content-Type': 'application/json',
        // Bearer auth via the better-auth apiKey plugin — resolves to the
        // free-plan user the key was minted for.
        Authorization: `Bearer ${API_KEY}`,
      },
    },
  )

  if (res.status === 429) {
    rateLimitedCount.add(1)
    // Presence-only check: a 429 MUST carry a rate-limit header (draft-7 or concurrent cap)
    // k6 lowercases all header names: 'RateLimit' → 'Ratelimit', 'X-RateLimit-Concurrent' → 'X-Ratelimit-Concurrent'
    check(res, {
      '429 has rate-limit header': (r) =>
        r.headers['Ratelimit'] !== undefined ||
        r.headers['X-Ratelimit-Concurrent'] !== undefined,
    })
  } else if (res.status >= 500) {
    fivexxCount.add(1)
  } else {
    // 202 Accepted (job queued) or 200 OK are both valid non-error responses
    check(res, {
      'non-429 is 2xx': (r) => r.status >= 200 && r.status < 300,
    })
  }
  // No sleep() — tight loop required to exceed the 10 req/min free-plan cap with 20 VUs
}
