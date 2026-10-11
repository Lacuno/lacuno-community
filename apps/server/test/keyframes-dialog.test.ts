import { expect, it } from 'vitest'
import { editor, openFormatting } from './harness.js'

const raw = (value: string) => ({ type: 'raw', value })

it('creates custom keyframes from the Motion section, previews them and keeps them while used', async () => {
  const { context, origin, siteId, document, page, canvas, saved } = await editor({
    width: 1400,
    height: 900,
  })
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        { type: 'class.create', id: 'c-drift', local: true },
        {
          type: 'node.create',
          parent: 'n-home-main',
          index: 0,
          node: {
            id: 'n-drift',
            type: 'text',
            tag: 'h2',
            classes: ['c-drift'],
            children: [],
            text: { type: 'static', value: 'Drift.' },
          },
        },
      ],
    },
  })
  expect(response.status()).toBe(200)
  const style = async (property: string) =>
    (await document()).styles[`c-drift|base|none|${property}`]?.value
  const heading = canvas.locator('[data-lacuno-node="n-drift"]')
  await heading.click()
  await expect.poll(() => heading.getAttribute('data-lacuno-selected')).toBe('')
  await openFormatting(page, 'Motion')
  const animation = page.getByLabel('Motion animation', { exact: true })
  const edit = page.getByRole('button', { name: 'Edit keyframes', exact: true })
  expect(await edit.count()).toBe(0)

  // New keyframes… opens the dialog; a bad line or a repeated stop keeps Save off.
  await animation.selectOption({ label: 'New keyframes…' })
  const dialog = page.getByRole('dialog', { name: 'New keyframes' })
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await dialog.getByLabel('Name').fill('drift')
  await dialog.getByLabel('Stop 1 styles').fill('opacity: 0; translate: 0 40px')
  await dialog.getByRole('button', { name: 'Add stop' }).click()
  expect(await dialog.getByLabel('Stop 2 at').inputValue()).toBe('100')
  const second = dialog.getByLabel('Stop 2 styles')
  await second.fill('translate 0 -4px')
  expect(await second.getAttribute('aria-invalid')).toBe('true')
  expect(await save.isDisabled()).toBe(true)
  await second.fill('translate: 0 -4px')
  await dialog.getByLabel('Stop 2 at').fill('0')
  expect(await dialog.getByLabel('Stop 2 at').getAttribute('aria-invalid')).toBe('true')
  expect(await save.isDisabled()).toBe(true)
  await dialog.getByLabel('Stop 2 at').fill('60')
  await save.click()

  // Saving creates them and makes them the element's animation.
  await expect.poll(() => dialog.count()).toBe(0)
  await expect.poll(() => style('--lc-entrance')).toEqual(raw('drift'))
  expect((await document()).keyframes.drift).toEqual({
    id: 'drift',
    stops: [
      { at: 0, styles: { opacity: raw('0'), translate: raw('0 40px') } },
      { at: 60, styles: { translate: raw('0 -4px') } },
    ],
  })
  await expect.poll(() => animation.inputValue()).toBe('drift')
  expect(await edit.count()).toBe(1)

  // Following the scroll, the canvas runs them in Preview and rests in edit mode.
  await page.getByRole('button', { name: 'Follow scroll', exact: true }).click()
  await expect.poll(() => style('--lc-scroll')).toEqual(raw('drift'))
  await saved()
  const names = () =>
    heading.evaluate((node) =>
      node.getAnimations().map((item) => (item as CSSAnimation).animationName),
    )
  expect(await names()).toEqual([])
  await page.getByRole('button', { name: 'Preview motion', exact: true }).click()
  await expect.poll(names).toEqual(['drift'])
  await page.keyboard.press('Escape')
  await expect.poll(names).toEqual([])

  // The pencil edits them; deleting is refused while a class uses them.
  await edit.click()
  const editing = page.getByRole('dialog', { name: 'drift' })
  await editing.getByLabel('Stop 2 styles').fill('translate: 0 -8px')
  await editing.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () => (await document()).keyframes.drift?.stops[1]?.styles.translate)
    .toEqual(raw('0 -8px'))
  await edit.click()
  await editing.getByRole('button', { name: 'Delete', exact: true }).click()
  expect(await editing.getByRole('alert').textContent()).toBe(
    'Used by Heading. Choose another animation there first.',
  )
  await editing.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await document()).keyframes.drift).toBeDefined()
}, 60_000)
