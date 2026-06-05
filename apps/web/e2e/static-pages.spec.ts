import { expect, test } from './support/fixtures'

const STATIC_PAGES = ['/cite', '/glossary', '/legal', '/imprint'] as const

test.describe('static pages', () => {
  for (const pagePath of STATIC_PAGES) {
    test(`${pagePath} loads without console errors`, async ({
      page,
      consoleErrors,
    }) => {
      await page.goto(pagePath)
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('main')).not.toBeEmpty()

      expect(consoleErrors).toEqual([])
    })
  }
})
