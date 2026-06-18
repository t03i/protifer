// End-to-end pipeline scenario (pro plan): submit a UNIQUE sequence and poll the
// returned statusUrl to terminal state, recording true submit→complete latency.
//
// Unlike rate-limiter/throughput/shedding — which stop at the 202 and so only
// measure the admission layer — this is the only scenario that exercises the real
// compute path (embedding-worker + prediction-worker + Triton) and reflects whether
// the workers actually keep up under load.
//
// COST WARNING: every iteration submits a unique random sequence (cache miss → real
// GPU inference) and leaves a permanent hash-keyed entry in prod S3. Run at low VUs,
// on demand only — never wire this into the weekly cron.
//
//   k6 run -e LOAD_TEST_PRO_BEARER=$KEY -e PROD_GATEWAY_URL=$URL tests/load/pipeline.js
//
// Read e2e_latency (submit→complete) as the headline number; submit_latency isolates
// the gateway 202 from the queue+compute time. Both are tagged by len_bucket.

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend, Counter } from 'k6/metrics'

import { randomSequence, sampleLength } from './sequences.js'

const BASE_URL = __ENV.PROD_GATEWAY_URL || 'http://localhost:3001'
const API_KEY = __ENV.LOAD_TEST_PRO_BEARER || ''

// 'mixed' (default) samples the weighted length distribution; 'fixed' pins every
// request to LOAD_TEST_SEQ_LENGTH so per-run compute stays comparable for trending.
const LENGTH_PROFILE = __ENV.LOAD_TEST_LENGTH_PROFILE || 'mixed'
const FIXED_LENGTH = Number(__ENV.LOAD_TEST_SEQ_LENGTH || 350)

// Generous ceiling: long sequences plus queue wait under load can take a while.
const E2E_TIMEOUT_MS = Number(__ENV.E2E_TIMEOUT || 180) * 1000
const POLL_INTERVAL_S = Number(__ENV.POLL_INTERVAL || 1)

const e2eLatency = new Trend('e2e_latency', true)
const submitLatency = new Trend('submit_latency', true)
const jobsCompleted = new Counter('jobs_completed')
const jobsFailed = new Counter('jobs_failed')
const jobsTimedOut = new Counter('jobs_timed_out')
const submitShed = new Counter('submit_shed')
const pollCount = new Counter('poll_count')

export const options = {
  // In-flight jobs ≈ VUs, since each VU holds one job open until it completes.
  // Keep at/under the pro-plan concurrent-job cap so we measure throughput, not
  // admission shedding. Override with LOAD_TEST_VUS once the cap is known.
  vus: Number(__ENV.LOAD_TEST_VUS || 3),
  duration: __ENV.LOAD_TEST_DURATION || '5m',
  thresholds: {
    // Collect-only baseline: fail only on genuine transport/5xx errors. Expected
    // 429 (concurrent-cap shed) is excluded via the submit responseCallback below,
    // and the 202/200 poll lifecycle is handled in-script.
    http_req_failed: ['rate<0.05'],
  },
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

function lenBucket(len) {
  if (len <= 400) return 'short'
  if (len <= 1024) return 'medium'
  return 'long'
}

export default function () {
  const seqLen = LENGTH_PROFILE === 'fixed' ? FIXED_LENGTH : sampleLength()
  const bucket = lenBucket(seqLen)
  const headers = {
    'Content-Type': 'application/json',
    // Bearer auth via the better-auth apiKey plugin — resolves to the pro-plan
    // user the key was minted for. The poll handler enforces same-user ownership,
    // so the same key must be used for submit and poll.
    Authorization: `Bearer ${API_KEY}`,
  }

  const submitStart = Date.now()
  const submit = http.post(
    `${BASE_URL}/v1/predictions`,
    JSON.stringify({ sequence: randomSequence(seqLen) }),
    {
      headers,
      tags: { name: 'submit', len_bucket: bucket },
      // Treat 429 (concurrent-cap shed) as a non-failure; handled below.
      responseCallback: http.expectedStatuses({ min: 200, max: 499 }),
    },
  )
  submitLatency.add(submit.timings.duration, { len_bucket: bucket })

  if (submit.status === 429) {
    submitShed.add(1)
    sleep(1) // concurrent-job cap hit — back off before the next iteration
    return
  }
  if (submit.status !== 202) {
    check(submit, { 'submit accepted (202)': () => false })
    return
  }

  let statusUrl
  try {
    statusUrl = JSON.parse(submit.body).statusUrl
  } catch {
    check(submit, { 'submit body is valid JSON': () => false })
    return
  }
  if (!statusUrl) {
    check(submit, { 'submit returned statusUrl': () => false })
    return
  }

  // Poll the async job to a terminal state. The gateway returns 202 while
  // queued/processing and 200 with status complete|failed once terminal.
  while (Date.now() - submitStart < E2E_TIMEOUT_MS) {
    sleep(POLL_INTERVAL_S)
    const poll = http.get(`${BASE_URL}${statusUrl}`, {
      headers,
      tags: { name: 'poll', len_bucket: bucket },
    })
    pollCount.add(1)

    let status
    try {
      status = JSON.parse(poll.body).status
    } catch {
      continue // transient unparseable body — keep polling until the timeout
    }

    if (status === 'complete') {
      e2eLatency.add(Date.now() - submitStart, { len_bucket: bucket })
      jobsCompleted.add(1)
      check(poll, { 'job completed': () => true })
      return
    }
    if (status === 'failed') {
      jobsFailed.add(1)
      check(poll, { 'job did not fail': () => false })
      return
    }
    // 'queued' | 'processing' → keep polling.
  }

  jobsTimedOut.add(1)
  check(null, { 'job completed within E2E_TIMEOUT': () => false })
}
