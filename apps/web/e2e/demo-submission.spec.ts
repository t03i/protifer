import path from 'node:path'

import { expect, test } from './support/fixtures'

test.use({
  extraHTTPHeaders: { 'x-e2e-auth': 'authenticated' },
})

test('demo submission P04637 renders prediction results', async ({ page }) => {
  // Intercept the external UniProt API before navigating — the route loader fires
  // immediately on navigation, so the mock MUST be registered first.
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

  await page.goto('/')

  const heroInput = page.getByRole('textbox', {
    name: /uniprot accession or sequence/i,
  })
  await heroInput.fill('P04637')

  await page
    .getByRole('button', { name: /predict/i })
    .first()
    .click()

  await expect(page).toHaveURL(/\/results\/uniprot\/P04637/)

  // SequenceDisplay renders "UniProt KB · P04637" once the loader resolves
  await expect(page.getByText('UniProt KB · P04637')).toBeVisible({
    timeout: 15_000,
  })

  // Poll cycle (queued -> processing -> complete) runs via the mocked poll route.
  // After completion, PredictionResults replaces skeletons with the DownloadButton.
  await expect(
    page.getByRole('button', { name: /download json/i }),
  ).toBeVisible({ timeout: 20_000 })
})
