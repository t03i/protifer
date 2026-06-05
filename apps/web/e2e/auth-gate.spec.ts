import { expect, test } from './support/fixtures'

// Unauthenticated is the default — no x-e2e-auth header set means mock plugin
// returns null session, which triggers isAuthenticated: false and the auth gate.

test.describe('auth gate — desktop', () => {
  test('unauthenticated access to protected route shows blur and login modal', async ({
    page,
  }) => {
    // Q99999 is not a demo accession, so auth gate fires
    await page.goto('/results/uniprot/Q99999')

    const modal = page.locator('[data-slot="dialog-content"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    await expect(page.locator('#app-content')).toHaveClass(/blur-sm/)

    // Non-dismissable via Escape key
    await page.keyboard.press('Escape')
    await expect(modal).toBeVisible()

    // Non-dismissable via click outside
    await page.mouse.click(10, 10)
    await expect(modal).toBeVisible()
  })
})

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('auth modal touch targets are reachable at mobile viewport', async ({
    page,
  }) => {
    await page.goto('/results/uniprot/Q99999')

    const modal = page.locator('[data-slot="dialog-content"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    const loginBtn = modal.getByRole('button', {
      name: /sign in with github/i,
    })
    await expect(loginBtn).toBeVisible()

    // WCAG 2.5.5: minimum touch target 44x44px (issue #58)
    const box = await loginBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})
