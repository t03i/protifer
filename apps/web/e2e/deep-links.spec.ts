import path from 'node:path'

import { expect, test } from './support/fixtures'

test.use({
  extraHTTPHeaders: { 'x-e2e-auth': 'authenticated' },
})

test('deep link to /results/uniprot/P04637 loads with mocked data', async ({
  page,
  consoleErrors,
}) => {
  // Register the external UniProt API mock BEFORE navigating — the route loader
  // fires immediately on navigation and would race a post-goto registration.
  await page.route('**/rest.uniprot.org/**', async (route) => {
    const fixturePath = path.join(
      import.meta.dirname,
      'fixtures',
      'uniprot-p04637.json',
    )
    await route.fulfill({ path: fixturePath, contentType: 'application/json' })
  })

  await page.route('**/v1/predictions', async (route) => {
    if (route.request().method() === 'POST') {
      const fixturePath = path.join(
        import.meta.dirname,
        'fixtures',
        'submit-response.json',
      )
      await route.fulfill({
        path: fixturePath,
        contentType: 'application/json',
      })
    } else {
      await route.continue()
    }
  })

  // Poll route serves queued -> processing -> complete in sequence
  let pollCount = 0
  await page.route('**/v1/predictions/**', async (route) => {
    if (route.request().method() === 'GET') {
      pollCount++
      let fixture: string
      if (pollCount === 1) fixture = 'poll-queued.json'
      else if (pollCount === 2) fixture = 'poll-processing.json'
      else fixture = 'poll-complete-p04637.json'
      const fixturePath = path.join(import.meta.dirname, 'fixtures', fixture)
      await route.fulfill({
        path: fixturePath,
        contentType: 'application/json',
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/results/uniprot/P04637')

  // SequenceDisplay renders the accession link once the loader resolves
  await expect(page.getByText('UniProt KB · P04637')).toBeVisible({
    timeout: 15_000,
  })

  // Prediction results load after the poll cycle completes
  await expect(
    page.getByRole('button', { name: /download json/i }),
  ).toBeVisible({ timeout: 20_000 })

  await expect(page.getByText(/P04637/)).toBeVisible()

  expect(consoleErrors).toEqual([])
})
