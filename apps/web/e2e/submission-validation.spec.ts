import { expect, test } from './support/fixtures'

test.use({
  extraHTTPHeaders: { 'x-e2e-auth': 'authenticated' },
})

test('landing page renders with sequence input field', async ({ page }) => {
  await page.goto('/')

  const heroInput = page.getByRole('textbox', {
    name: /uniprot accession or sequence/i,
  })
  await expect(heroInput).toBeVisible()

  const sequenceTextarea = page.getByPlaceholder(
    /enter protein sequence, uniprot id, or fasta/i,
  )
  await expect(sequenceTextarea).toBeVisible()

  await expect(
    page.getByRole('button', { name: /predict/i }).first(),
  ).toBeVisible()
})

test('submit button is disabled for empty input', async ({ page }) => {
  await page.goto('/')

  const predictButton = page
    .locator('section#predict')
    .getByRole('button', { name: /predict/i })

  await expect(predictButton).toBeDisabled()
})

test('submit button is disabled for invalid input', async ({ page }) => {
  await page.goto('/')

  const textarea = page.getByPlaceholder(
    /enter protein sequence, uniprot id, or fasta/i,
  )
  await textarea.fill('123')

  const predictButton = page
    .locator('section#predict')
    .getByRole('button', { name: /predict/i })

  // Button stays disabled because '123' is <= MIN_INPUT_LEN and not a valid accession
  await expect(predictButton).toBeDisabled()
})

test('validation error shown for extended IUPAC characters', async ({
  page,
}) => {
  await page.goto('/')

  const textarea = page.getByPlaceholder(
    /enter protein sequence, uniprot id, or fasta/i,
  )
  // B and Z are extended IUPAC characters — should trigger the warning alert
  await textarea.fill('ACDEFGHIKLMNBZACDEFGHIKLMN')

  // SequenceInput renders an Alert when alphabet === InputAlphabet.iupac_extended
  await expect(
    page.getByText(/extended iupac characters.*will be mapped to x/i),
  ).toBeVisible()
})
