import path from 'node:path'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

it('creates, customizes, edits and detaches reusable components through distinct controls', async () => {
  const { page, canvas, document } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await canvas.locator('[data-lacuno-node="n-home-hero-note"]').dispatchEvent('click')
  await page.getByRole('button', { name: 'Components', exact: true }).click()
  const rail = page.getByRole('navigation', { name: 'Editor panels' })
  const collapsedWidth = (await rail.boundingBox())!.width
  const content = page.getByRole('region', { name: 'Components panel' })
  const contentWidth = (await content.boundingBox())!.width
  await page.getByRole('button', { name: 'Expand sidebar labels' }).click()
  expect(await rail.getByRole('button', { name: 'Components', exact: true }).textContent()).toBe(
    'Components',
  )
  expect((await rail.boundingBox())!.width).toBeGreaterThan(collapsedWidth)
  expect((await content.boundingBox())!.width).toBe(contentWidth)
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/sidebar-expanded.png'),
  })
  await page.getByRole('button', { name: 'Collapse sidebar labels' }).click()
  expect((await rail.boundingBox())!.width).toBe(collapsedWidth)
  expect(
    await rail
      .getByRole('button', { name: 'Components', exact: true })
      .getAttribute('aria-pressed'),
  ).toBe('true')
  await page.getByRole('button', { name: 'Create component…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create component', exact: true })
  await dialog.getByLabel('Name', { exact: true }).fill('Promo panel')
  await dialog.getByText('Allow instance-specific text', { exact: true }).click()
  await dialog.getByRole('checkbox').first().check()
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/component-create.png'),
  })
  await dialog.getByRole('button', { name: 'Create component', exact: true }).click()
  await expect.poll(() => dialog.count()).toBe(0)
  const extracted = await document()
  const component = Object.values(extracted.components).find((item) => item.name === 'Promo panel')!
  expect(component).toBeDefined()
  const instance = Object.values(extracted.nodes).find(
    (node) => node.type === 'component' && node.component === component.id,
  )!
  await expect.poll(() => canvas.locator(`[data-lacuno-node="${instance.id}"]`).count()).toBe(1)
  expect(await canvas.locator('[data-lacuno-node="n-home-note-top"]').count()).toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await document()).components[component.id]).toBeUndefined()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect
    .poll(async () => (await document()).components[component.id]?.name)
    .toBe('Promo panel')
  await canvas.locator(`[data-lacuno-node="${instance.id}"]`).dispatchEvent('click')
  await page.getByLabel(component.props[0]!.label!, { exact: true }).fill('Only this instance')
  await expect
    .poll(async () => {
      const node = (await document()).nodes[instance.id]
      return node?.type === 'component' ? node.props?.[component.props[0]!.name] : null
    })
    .toEqual({ type: 'static', value: 'Only this instance' })
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/component-instance.png'),
  })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  expect(await page.getByRole('button', { name: 'Insert Promo panel', exact: true }).count()).toBe(
    0,
  )
  await page.getByRole('button', { name: 'Components', exact: true }).click()
  await expect
    .poll(() => page.getByRole('button', { name: 'Create component…', exact: true }).isDisabled())
    .toBe(true)
  await page.screenshot({ path: path.join(root, '.lacuno/editor-preview/components-tab.png') })
  await page.getByRole('button', { name: 'Insert Promo panel', exact: true }).click()
  await expect
    .poll(
      async () =>
        Object.values((await document()).nodes).filter(
          (node) => node.type === 'component' && node.component === component.id,
        ).length,
    )
    .toBe(2)
  await page.getByRole('button', { name: 'Edit shared component', exact: true }).click()
  await expect.poll(() => canvas.locator('[data-lacuno-node="n-home-note-copy"]').count()).toBe(1)
  await canvas.locator('[data-lacuno-node="n-home-note-copy"]').click()
  await page.getByLabel('Text', { exact: true }).fill('Shared text changed on the canvas')
  await expect
    .poll(async () => {
      const node = (await document()).nodes['n-home-note-copy']
      return node?.type === 'text' ? node.text : null
    })
    .toEqual({ type: 'static', value: 'Shared text changed on the canvas' })
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/component-shared.png'),
  })
  await page.getByRole('button', { name: 'Component settings…', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Component settings', exact: true })
  await settings.getByLabel(component.props[0]!.label!, { exact: true }).fill('Shared default')
  await settings.getByRole('button', { name: 'Save component settings', exact: true }).click()
  await expect.poll(() => settings.count()).toBe(0)
  await page.getByRole('button', { name: 'Component settings…', exact: true }).click()
  expect(
    await settings
      .getByRole('button', { name: `Remove field ${component.props[0]!.label}` })
      .isDisabled(),
  ).toBe(true)
  await settings.getByLabel('Text to expose').selectOption('n-home-note-copy')
  await settings.getByRole('button', { name: 'Add text field', exact: true }).click()
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await document()).components[component.id]!.props).toHaveLength(1)
  await page.getByRole('button', { name: 'Component settings…', exact: true }).click()
  await settings.getByLabel('Text to expose').selectOption('n-home-note-copy')
  await settings.getByRole('button', { name: 'Add text field', exact: true }).click()
  await settings
    .getByRole('textbox', { name: 'Field name for', exact: false })
    .last()
    .fill('Description')
  await settings
    .getByLabel(`Field name for ${component.props[0]!.name}`, { exact: true })
    .fill('Eyebrow')
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/component-fields.png'),
  })
  await settings.getByRole('button', { name: 'Save component settings', exact: true }).click()
  await expect.poll(() => settings.count()).toBe(0)
  expect((await document()).components[component.id]!.props).toHaveLength(2)
  await page.getByRole('button', { name: 'Component settings…', exact: true }).click()
  await settings.getByRole('button', { name: 'Remove field Description', exact: true }).click()
  await settings.getByRole('button', { name: 'Save component settings', exact: true }).click()
  await expect.poll(() => settings.count()).toBe(0)
  expect((await document()).components[component.id]!.props).toHaveLength(1)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect
    .poll(() => canvas.getByText('Shared text changed on the canvas', { exact: true }).count())
    .toBe(2)
  await expect.poll(() => canvas.getByText('Only this instance', { exact: true }).count()).toBe(1)
  await expect.poll(() => canvas.getByText('Shared default', { exact: true }).count()).toBe(1)
  await canvas.locator(`[data-lacuno-node="${instance.id}"]`).dispatchEvent('click')
  await page.getByText('Instance actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Detach from component…' }).click()
  const detach = page.getByRole('dialog', { name: 'Detach component', exact: true })
  await detach.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await document()).nodes[instance.id]?.type).toBe('component')
  await page.getByRole('button', { name: 'Detach from component…' }).click()
  await detach.getByRole('button', { name: 'Detach component', exact: true }).click()
  await expect.poll(async () => (await document()).nodes[instance.id]).toBeUndefined()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await document()).nodes[instance.id]?.type).toBe('component')
  await page.reload()
  await expect.poll(() => canvas.getByText('Only this instance', { exact: true }).count()).toBe(1)
  await expect.poll(() => canvas.getByText('Shared default', { exact: true }).count()).toBe(1)
  await page.getByRole('button', { name: 'Components', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for Promo panel', exact: true }).click()
  const manage = page.getByRole('dialog', { name: 'Manage Promo panel', exact: true })
  await manage.getByText('Delete component', { exact: true }).click()
  await manage
    .getByText('Used by 2 instances. Remove or detach them before deleting this component.', {
      exact: true,
    })
    .waitFor()
  expect(await manage.getByRole('button', { name: 'Confirm delete component' }).count()).toBe(0)
  await manage.getByRole('button', { name: 'Duplicate component', exact: true }).click()
  await expect.poll(() => manage.count()).toBe(0)
  const copy = Object.values((await document()).components).find(
    (item) => item.name === 'Promo panel copy',
  )!
  expect(copy).toBeDefined()
  await page.getByRole('button', { name: 'Actions for Promo panel copy', exact: true }).click()
  const copyDialog = page.getByRole('dialog', { name: 'Manage Promo panel copy', exact: true })
  await copyDialog.getByText('Delete component', { exact: true }).click()
  await copyDialog.getByRole('button', { name: 'Delete component…', exact: true }).click()
  await copyDialog.getByRole('button', { name: 'Keep component', exact: true }).click()
  expect((await document()).components[copy.id]).toBeDefined()
  await copyDialog.getByRole('button', { name: 'Delete component…', exact: true }).click()
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/component-management.png'),
  })
  await copyDialog.getByRole('button', { name: 'Confirm delete component', exact: true }).click()
  await expect.poll(() => copyDialog.count()).toBe(0)
  expect((await document()).components[copy.id]).toBeUndefined()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(async () => (await document()).components[copy.id]?.name)
    .toBe('Promo panel copy')
  expect(errors).toEqual([])
}, 40000)
