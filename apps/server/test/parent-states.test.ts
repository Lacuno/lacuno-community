import { expect, it } from 'vitest'
import { editor, openInspectorTab } from './harness.js'

it("styles an accordion icon while its item is open, keeps the parent's state inside it, and jumps to an anchor", async () => {
  const { page, canvas, document, saved } = await editor()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Accordion', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()
  const item = canvas.locator('details').first()
  const icon = item.getByText('+', { exact: true })
  const rotate = () => icon.evaluate((element) => getComputedStyle(element).rotate)
  const pickState = async (name: string) => {
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name }).click()
  }

  // The icon's menu offers its item's Open; picking it opens the item on the canvas, turned.
  await icon.click()
  expect(await item.getAttribute('open')).toBeNull()
  await pickState('Accordion item · Open While Accordion item is open')
  await expect.poll(() => item.getAttribute('data-lc-state')).toBe('open')
  await expect.poll(() => item.getAttribute('open')).toBe('')
  await expect.poll(rotate).toBe('45deg')
  await expect
    .poll(() => page.getByLabel('Editing state').inputValue())
    .toMatch(/^open@c-[0-9a-f-]+$/)

  // Inside the open item the state stays the item's; back to Default the item closes again.
  await item.getByText('Write the answer here.').click()
  await expect
    .poll(() => canvas.getByRole('button', { name: 'State: Accordion item · Open' }).count())
    .toBe(1)
  await pickState('Default How the element normally looks')
  await expect.poll(() => item.getAttribute('open')).toBeNull()
  expect(await item.getAttribute('data-lc-state')).toBeNull()
  // It eases back, as it eased in.
  await expect.poll(rotate).toBe('none')

  // Show open opens a closed item for editing its answer, and Hide closes it, all unsaved.
  await item.getByText('What does it cost?').click()
  await canvas.getByRole('button', { name: 'Show open', exact: true }).click()
  await expect.poll(() => item.getAttribute('open')).toBe('')
  await canvas.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect.poll(() => item.getAttribute('open')).toBeNull()

  // An anchor on the item: its id, and with it the Jumped to state.
  await page.locator('.layer', { hasText: 'Accordion item' }).first().click()
  await openInspectorTab(page, 'Advanced')
  await page.getByLabel('Anchor', { exact: true }).fill('#pricing')
  await page.getByLabel('Anchor', { exact: true }).press('Enter')
  await saved()
  const anchored = Object.values((await document()).nodes).find(
    (node) =>
      'attrs' in node && node.attrs?.id?.type === 'static' && node.attrs.id.value === 'pricing',
  )
  expect(anchored).toMatchObject({ tag: 'details' })
  await pickState('Jumped to After a link to its anchor brought the visitor here')
  await expect.poll(() => item.getAttribute('data-lc-state')).toBe('target')
}, 120_000)
