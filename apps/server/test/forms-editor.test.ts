import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('inserts a form, keeps fields inside it and edits a field name and Required', async () => {
  const { page, canvas, document, saved } = await editor()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()
  const insert = async (name: string, position = 'page') => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByLabel('Insert position', { exact: true }).selectOption(position)
    await page.getByRole('button', { name: 'Insert element', exact: true }).click()
    await saved()
  }

  // A field has no place on the page outside a form.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Text field', exact: true }).click()
  await page.getByText('Place form fields inside a form.').waitFor()

  await insert('Form')
  await canvas.locator('form label', { hasText: 'Message' }).locator('textarea').waitFor()
  await expect
    .poll(() => page.getByLabel('Form name', { exact: true }).inputValue())
    .toBe('Contact form')
  await page.getByText('Submissions are emailed to the workspace owner.').waitFor()

  // The form stays selected, so a text field goes inside it with a name of its own.
  await insert('Text field', 'inside')
  const fieldName = page.getByLabel('Field name', { exact: true })
  await expect.poll(() => fieldName.inputValue()).toBe('name-2')
  await fieldName.fill('company')
  await fieldName.press('Enter')
  await saved()
  await page.getByLabel('Required', { exact: true }).click()
  await saved()
  await canvas.locator('form input[name="company"][required]').waitFor()

  const nodes = Object.values((await document()).nodes)
  const form = nodes.find((node) => node.type === 'element' && node.tag === 'form')!
  const company = nodes.find(
    (node) => node.attrs?.name?.type === 'static' && node.attrs.name.value === 'company',
  )!
  expect(company.attrs).toMatchObject({
    type: { value: 'text' },
    required: { value: true },
  })
  expect(nodes.find((node) => node.id === company.parent)?.parent).toBe(form.id)
}, 120_000)
