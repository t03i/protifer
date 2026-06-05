import { expect, test } from './support/fixtures'

test('smoke: landing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/protifer/i)
})
