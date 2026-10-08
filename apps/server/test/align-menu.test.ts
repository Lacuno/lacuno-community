import { expect, it } from 'vitest'
import { clippedFocusRings, editor, openFormatting } from './harness.js'

/** Sets one base style on a class through the API, as an agent would. */
const style = async (
  launched: Awaited<ReturnType<typeof editor>>,
  classId: string,
  property: string,
  value: string,
  node?: { id: string; parent: string },
) => {
  const { context, origin, siteId, document } = launched
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        ...(node ? [{ type: 'class.create', id: classId, local: true }] : []),
        {
          type: 'style.set',
          class: classId,
          breakpoint: 'base',
          state: 'none',
          property,
          value: { type: 'raw', value },
        },
        ...(node
          ? [
              {
                type: 'node.create',
                parent: node.parent,
                index: 0,
                node: {
                  id: node.id,
                  type: 'element',
                  tag: 'div',
                  classes: [classId],
                  children: [],
                },
              },
            ]
          : []),
      ],
    },
  })
  expect(response.status()).toBe(200)
}

it('aligns grid children on independent axes, keeps the menu open, and reflects the current position', async () => {
  const launched = await editor({ width: 1200, height: 1000 })
  const { page, canvas, saved, document } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const child = canvas.locator('[data-lacuno-node="n-home-choice-hosted"]')
  const parent = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  await child.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await child.dispatchEvent('click')
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  await chip.click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  const before = (await document()).styles
  await menu.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  await expect.poll(() => menu.isVisible()).toBe(true)
  expect(await child.evaluate((el) => getComputedStyle(el).justifySelf)).toBe('end')
  await menu.getByRole('button', { name: 'Vertical: Bottom', exact: true }).click()
  await saved()
  expect(
    await child.evaluate((el) => [
      getComputedStyle(el).justifySelf,
      getComputedStyle(el).alignSelf,
    ]),
  ).toEqual(['end', 'end'])
  await expect
    .poll(() =>
      menu.getByRole('button', { name: 'Horizontal: Right' }).getAttribute('aria-pressed'),
    )
    .toBe('true')
  await expect
    .poll(() => menu.getByRole('button', { name: 'Vertical: Bottom' }).getAttribute('aria-pressed'))
    .toBe('true')
  expect(await menu.getByRole('button', { name: 'Distribute siblings' }).count()).toBe(0)
  expect(await clippedFocusRings(page, '.align-menu', canvas)).toEqual([])
  const anchor = (await chip.boundingBox())!
  const popup = (await menu.boundingBox())!
  const frame = (await page.locator('iframe[title="Site canvas"]').boundingBox())!
  expect(popup.x).toBeGreaterThanOrEqual(frame.x)
  expect(popup.x + popup.width).toBeLessThanOrEqual(frame.x + frame.width)
  expect(popup.y).toBeGreaterThanOrEqual(frame.y)
  expect(popup.y + popup.height).toBeLessThanOrEqual(frame.y + frame.height)
  expect(popup.x).toBeLessThanOrEqual(anchor.x + 1)
  await page.keyboard.press('Escape')
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await child.evaluate((el) => getComputedStyle(el).justifySelf)).toBe('end')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect((await document()).styles).toEqual(before)

  // Distributing siblings is a separately named action on a flex parent with room along its flow.
  await parent.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await saved()
  await child.dispatchEvent('click')
  // The panels fill the Row: nothing can move, so there is no Align chip.
  await expect.poll(() => chip.count()).toBe(0)
  await style(launched, 'c-choice-panel', 'width', '300px')
  await page.reload()
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  await child.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await child.dispatchEvent('click')
  await chip.click()
  await menu.getByRole('button', { name: 'Distribute siblings' }).click()
  await saved()
  expect(await parent.evaluate((el) => getComputedStyle(el).justifyContent)).toBe('space-between')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await parent.evaluate((el) => getComputedStyle(el).justifyContent)).not.toBe(
    'space-between',
  )
  expect(errors).toEqual([])
}, 60_000)

it('offers only horizontal controls in a block parent and hides them while editing text', async () => {
  const { page, canvas, saved } = await editor()
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.click()
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  await chip.click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  expect(await menu.getByRole('group', { name: 'Horizontal alignment' }).count()).toBe(1)
  expect(await menu.getByRole('group', { name: 'Vertical alignment' }).count()).toBe(0)
  const copy = (await canvas.locator('[data-lacuno-node="n-home-hero-copy"]').boundingBox())!
  const before = (await cta.boundingBox())!
  await menu.getByRole('button', { name: 'Horizontal: Center', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      cta.evaluate((el) =>
        ['margin-left', 'margin-right'].map((p) => String(el.computedStyleMap().get(p))),
      ),
    )
    .toEqual(['auto', 'auto'])
  // The inline-flex button becomes a fitted flex box, so the auto margins centre it.
  const after = (await cta.boundingBox())!
  expect(after.width).toBeCloseTo(before.width, 0)
  expect(after.x + after.width / 2).toBeCloseTo(copy.x + copy.width / 2, 0)
  expect(await cta.evaluate((el) => getComputedStyle(el).display)).toBe('flex')
  await menu.getByRole('button', { name: 'Close alignment controls' }).click()
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
  await cta.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  await expect.poll(() => chip.count()).toBe(0)
  await page.keyboard.press('Escape')
}, 60_000)

it('disables the options without room and says why, keeps text alignable, and hides Distribute in a filled Stack', async () => {
  const launched = await editor({ width: 1200, height: 1000 })
  const { page, canvas, saved } = launched
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  const note = menu.locator('.align-note')
  const option = (name: string) => menu.getByRole('button', { name, exact: true })
  // A block filling the width of its Stack moves only along the flow, where the Stack has room.
  const top = canvas.locator('[data-lacuno-node="n-home-choice-hosted-top"]')
  await top.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await top.dispatchEvent('click')
  await chip.click()
  await expect.poll(() => option('Horizontal: Right').isDisabled()).toBe(true)
  expect(await option('Horizontal: Left').isDisabled()).toBe(true)
  expect(await option('Vertical: In flow').isDisabled()).toBe(false)
  expect(await option('Vertical: Bottom').isDisabled()).toBe(false)
  expect(await note.textContent()).toBe('Fills the width of article. This element only')
  expect(await menu.getByRole('button', { name: 'Distribute siblings' }).count()).toBe(1)
  await page.keyboard.press('Escape')

  // As a Stack as tall as its children, nothing can move along the flow and nothing distributes.
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Stack layout', exact: true }).click()
  await saved()
  const label = canvas.locator('[data-lacuno-node="n-home-choice-hosted-label"]')
  await label.dispatchEvent('click')
  await chip.click()
  await expect.poll(() => option('Vertical: Middle').isDisabled()).toBe(true)
  expect(await option('Vertical: Bottom').isDisabled()).toBe(true)
  expect(await option('Vertical: In flow').isDisabled()).toBe(false)
  expect(await menu.getByRole('button', { name: 'Distribute siblings' }).count()).toBe(0)
  expect(await note.textContent()).toBe(
    'Container is only as tall as its children. This element only',
  )
  // A text node's ragged edge can always move sideways, even when its box fills the line.
  expect(await option('Horizontal: Right').isDisabled()).toBe(false)
  await page.keyboard.press('Escape')

  // Sideways on a wrapped paragraph the text follows, since the box itself cannot move.
  const copy = canvas.locator('[data-lacuno-node="n-home-note-copy"]')
  await copy.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await copy.dispatchEvent('click')
  await chip.click()
  await option('Horizontal: Right').click()
  await saved()
  await expect
    .poll(() =>
      copy.evaluate((el) => [getComputedStyle(el).textAlign, getComputedStyle(el).alignSelf]),
    )
    .toEqual(['end', 'flex-end'])
  await page.keyboard.press('Escape')

  // A page section filling its block parent has nothing to align within: no chip at all.
  const main = canvas.locator('[data-lacuno-node="n-home-main"]')
  await main.dispatchEvent('click')
  await expect.poll(() => canvas.locator('.selection-label .name').textContent()).toBe('main')
  expect(await chip.count()).toBe(0)
}, 60_000)

it('aligns a Container preset left and right past its own auto margins', async () => {
  const launched = await editor({ width: 1200, height: 1000 })
  const { page, canvas, saved, document } = launched
  // The preset's `margin: 0 auto` centres it; the longhands written after it must win.
  await style(launched, 'c-box', 'width', '50%', { id: 'n-box', parent: 'n-home-hero-copy' })
  await style(launched, 'c-box', 'margin', '0 auto')
  await style(launched, 'c-box', 'height', '40px')
  await page.reload()
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  const box = canvas.locator('[data-lacuno-node="n-box"]')
  const parent = (await canvas.locator('[data-lacuno-node="n-home-hero-copy"]').boundingBox())!
  expect((await box.boundingBox())!.x).toBeCloseTo(parent.x + parent.width / 4, 0)
  await box.dispatchEvent('click')
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  await menu.getByRole('button', { name: 'Horizontal: Left', exact: true }).click()
  await saved()
  await expect.poll(async () => (await box.boundingBox())!.x).toBeCloseTo(parent.x, 0)
  expect(await box.evaluate((el) => String(el.computedStyleMap().get('margin-left')))).toBe('0px')
  await menu.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  await expect
    .poll(async () => (await box.boundingBox())!.x)
    .toBeCloseTo(parent.x + parent.width / 2, 0)
  expect(
    Object.values((await document()).styles)
      .filter((s) => s.class === 'c-box')
      .map((s) => s.property),
  ).toEqual(expect.arrayContaining(['margin', 'margin-left', 'margin-right']))
}, 60_000)
