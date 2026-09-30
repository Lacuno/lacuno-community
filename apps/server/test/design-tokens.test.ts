import { expect, it } from 'vitest'
import { editor, openFormatting, press } from './harness.js'

it('creates a spacing token, binds a field to it, snaps a handle to it, detaches and publishes', async () => {
  const { server, page, canvas, document, publish, saved } = await editor({
    width: 1200,
    height: 1000,
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()

  // The CTA's own padding declaration for one side, read from the saved document.
  const ctaPadding = async (side: string) => {
    const doc = await document()
    return Object.values(doc.styles).find(
      (style) =>
        style.property === `padding-${side}` &&
        doc.nodes['n-home-cta']!.classes.includes(style.class),
    )?.value
  }
  // All four computed sides in one snapshot, so a comparison can't catch them mid-commit.
  const padding = () =>
    cta.evaluate((element) => {
      const style = getComputedStyle(element)
      return (['top', 'right', 'bottom', 'left'] as const).map((side) =>
        Number.parseFloat(style.getPropertyValue(`padding-${side}`)),
      )
    })

  // Create space.card at 20px in the Spacing group of the Design tokens dialog.
  const tokens = page.getByRole('dialog', { name: 'Design tokens' })
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  await tokens.getByRole('button', { name: 'Spacing', exact: true }).click()
  await tokens.getByLabel('Token name', { exact: true }).fill('Card')
  await tokens.getByLabel('Token value', { exact: true }).fill('20px')
  await tokens.getByRole('button', { name: 'Create token', exact: true }).click()
  await tokens.getByRole('heading', { name: 'space.card', exact: true }).waitFor()
  const card = Object.values((await document()).designTokens).find(
    (token) => token.name === 'space.card',
  )!
  expect(card).toMatchObject({ group: 'spacing', values: { light: { value: 20, unit: 'px' } } })
  await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()

  // Bind the top padding from the inspector: the field shows the token, the canvas its value.
  await cta.click()
  await openFormatting(page, 'Spacing & shape')
  const inspector = page.locator('aside.inspector')
  const top = inspector.getByLabel('Inside spacing top', { exact: true })
  const pickToken = async (side: string, name: string) => {
    await inspector.getByRole('button', { name: `Use a token for Inside spacing ${side}` }).click()
    await page
      .getByRole(name === 'Detach' ? 'menuitem' : 'menuitemradio', {
        name: new RegExp(`^${name}`),
      })
      .click()
  }
  await pickToken('top', 'card')
  await expect.poll(() => top.inputValue()).toBe('card')
  await expect.poll(async () => (await padding())[0]).toBe(20)
  await expect.poll(() => ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })
  await saved()

  // Changing the token moves the canvas without touching the element.
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  await tokens.getByRole('button', { name: 'Spacing', exact: true }).click()
  await tokens.getByRole('button', { name: /^card/ }).click()
  await tokens.getByLabel('Token value', { exact: true }).fill('32px')
  await expect.poll(async () => (await padding())[0]).toBe(32)
  await expect.poll(() => tokens.getByRole('status').textContent()).toBe('All changes saved')
  await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()
  await expect
    .poll(async () => (await document()).designTokens[card.id]!.values.light)
    .toEqual({ type: 'unit', value: 32, unit: 'px' })
  expect(await ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })

  // Both chains start pressed (the sides are symmetric), so a pick binds both sides of its pair.
  for (const pair of ['top and bottom', 'left and right'])
    await expect
      .poll(() =>
        inspector
          .getByRole('button', { name: `Link inside spacing ${pair}`, exact: true })
          .getAttribute('aria-pressed'),
      )
      .toBe('true')
  await pickToken('bottom', 'card')
  await pickToken('left', 'card')
  await expect.poll(padding).toEqual([32, 32, 32, 32])
  await saved()

  // A drag that ends within 4px of the token snaps to it: the readout names it and both sides
  // of the symmetric drag commit the reference.
  const zoom = await page
    .locator('iframe[title="Site canvas"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
  const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
  await spacingChip.click()
  await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
  // The readout while the pointer is still down, cssDy CSS px from the top nub.
  const drag = async (cssDy: number, modifiers = 0) => {
    const release = await press(page, '.handle.padding.top', { dy: cssDy * zoom }, modifiers)
    const readout = await canvas.locator('.tag').textContent()
    await release()
    return readout
  }
  expect(await drag(-3)).toBe('space.card')
  await saved()
  await expect.poll(() => ctaPadding('bottom')).toEqual({ type: 'designToken', ref: card.id })
  expect(await ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })
  await expect.poll(() => top.inputValue()).toBe('card')

  // Published CSS carries the token on :root and the reference as var().
  const live = await publish()
  const html = await (await server.published!.request(live)).text()
  const stylesheet = html.match(/href="(\/(?:_astro|assets)\/[^" ]+\.css)"/)?.[1]
  expect(stylesheet).toBeTruthy()
  const css = await (await server.published!.request(live + stylesheet)).text()
  expect(css).toMatch(/:root\{[^}]*--space-card:32px/)
  expect(css).toContain('var(--space-card)')

  // Detach writes the token's value to the linked pair as plain pixels; the other pair stays bound.
  await pickToken('top', 'Detach')
  await expect.poll(() => top.inputValue()).toBe('32px')
  await expect.poll(() => ctaPadding('top')).toEqual({ type: 'unit', value: 32, unit: 'px' })
  await saved()
  expect(await ctaPadding('bottom')).toEqual({ type: 'unit', value: 32, unit: 'px' })
  expect(await ctaPadding('left')).toEqual({ type: 'designToken', ref: card.id })

  // With Ctrl held nothing snaps, even within 4px of the token.
  expect(await drag(2, 2)).toBe('30px')
  await expect.poll(() => ctaPadding('top')).toEqual({ type: 'unit', value: 30, unit: 'px' })
  await saved()
  expect(await padding()).toEqual([30, 32, 30, 32])

  // The text toolbar's typography fields bind to typography tokens the same way.
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  await tokens.getByRole('button', { name: 'Typography', exact: true }).click()
  await tokens.getByLabel('Token name', { exact: true }).fill('body-size')
  await tokens.getByLabel('Token value', { exact: true }).fill('18px')
  await tokens.getByRole('button', { name: 'Create token', exact: true }).click()
  await tokens.getByRole('heading', { name: 'font.body-size', exact: true }).waitFor()
  await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()
  const bodySize = Object.values((await document()).designTokens).find(
    (token) => token.name === 'font.body-size',
  )!
  await openFormatting(page, 'Typography')
  const toolbar = page.getByRole('region', { name: 'Text formatting' })
  await toolbar.getByRole('button', { name: 'Use a token for Size' }).click()
  await page.getByRole('menuitemradio', { name: /^body-size/ }).click()
  await expect
    .poll(() => toolbar.getByLabel('Size', { exact: true }).inputValue())
    .toBe('body-size')
  await expect
    .poll(() => cta.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('18px')
  await expect
    .poll(async () => {
      const doc = await document()
      return Object.values(doc.styles).find(
        (style) =>
          style.property === 'font-size' && doc.nodes['n-home-cta']!.classes.includes(style.class),
      )?.value
    })
    .toEqual({ type: 'designToken', ref: bodySize.id })
  await saved()

  expect(errors).toEqual([])
}, 180_000)
