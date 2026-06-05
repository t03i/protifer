// CI-only contract test against the live 3D Beacons API.
// Runs ONLY when process.env.CI is set (GitHub Actions sets this automatically).
// Skipped during local `bun run --filter @protifer/web test`.
import { describe, expect, test } from 'vitest'

import { BeaconsSummarySchema } from './beacons'

const P05067_URL =
  'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P05067.json'

describe.runIf(process.env.CI)('3D Beacons contract (live API)', () => {
  test('P05067 response satisfies BeaconsSummarySchema', async () => {
    const response = await fetch(P05067_URL)
    expect(response.ok).toBe(true)
    const json = await response.json()
    // parse throws ZodError on mismatch — test fails with the exact path/issue.
    expect(() => BeaconsSummarySchema.parse(json)).not.toThrow()
  }, 15000)
})
