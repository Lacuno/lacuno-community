import path from 'node:path'
import type { TextNode } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { editor, openInspectorTab, pageSettings, root } from './harness.js'

it('adds a language, translates the site in it and removes it again', async () => {
  const { page, canvas, document: site, saved, api, siteId } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The preview image gets an alt text in English first, so it has one to translate.
  const before = await site()
  const image = before.nodes['n-home-preview-image']!
  await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: before.revision,
    operations: [
      {
        type: 'node.update',
        id: image.id,
        attrs: { ...image.attrs, alt: { type: 'static', value: 'The About page' } },
      },
      {
        type: 'node.update',
        id: 'n-home-choice-kicker',
        rotatingWords: { words: ['designers', { text: 'teams', icon: 'sparkles' }] },
      },
    ],
  })
  const picker = page.getByRole('button', { name: 'Language', exact: true })
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await expect.poll(() => picker.count()).toBe(0)

  // Site settings: German joins English.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Site settings' })
  await settings.getByLabel('Language code', { exact: true }).fill('de')
  await settings.getByRole('button', { name: 'Add language', exact: true }).click()
  await saved()
  await settings.getByLabel('Name of de', { exact: true }).waitFor()
  // German's tone, and a glossary: one term kept as it is, one translated.
  expect(await settings.getByRole('checkbox', { name: 'Keep in sync' }).count()).toBe(0)
  await settings.getByLabel('Tone of de', { exact: true }).selectOption('informal')
  await saved()
  for (const term of ['Lacuno', 'Website']) {
    await settings.getByLabel('New term', { exact: true }).fill(term)
    await settings.getByRole('button', { name: 'Add term', exact: true }).click()
    await saved()
  }
  await settings.getByLabel('Website in de', { exact: true }).fill('Webseite')
  await settings.getByLabel('Website in de', { exact: true }).blur()
  await saved()
  expect((await site()).site).toMatchObject({
    locales: [{ code: 'en-US' }, { code: 'de', tone: 'informal' }],
    glossary: [{ term: 'Lacuno' }, { term: 'Website', translations: { de: 'Webseite' } }],
  })
  await page.screenshot({ path: path.join(root, '.lacuno/editor-preview/languages-settings.png') })
  await settings.getByRole('button', { name: 'Close', exact: true }).click()

  // The picker switches the editor to German, where the layout is locked.
  await picker.click()
  await page.getByRole('menuitem', { name: /^Deutsch/ }).click()
  await expect.poll(() => picker.textContent()).toBe('DE')
  await expect.poll(() => heading.getAttribute('data-lacuno-translation')).toBe('missing')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText('Change the layout in English').waitFor()
  expect(await page.getByRole('button', { name: 'Heading' }).count()).toBe(0)

  // The heading, edited on the canvas, and the image's alt text become German translations.
  await heading.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await editable.press('ControlOrMeta+a')
  await editable.pressSequentially('Deine Website. Deine Regeln.')
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  await expect.poll(() => heading.textContent()).toBe('Deine Website. Deine Regeln.')
  await expect.poll(() => heading.getAttribute('data-lacuno-translation')).toBe(null)
  await canvas.locator(`[data-lacuno-node="${image.id}"]`).click()
  await openInspectorTab(page, 'Content')
  await page.getByLabel('Image alt text').fill('Die Über-uns-Seite')
  await saved()
  const translated = await site()
  expect(translated.translations.de).toMatchObject({
    'node:n-home-title.text': { value: 'Deine Website. Deine Regeln.' },
    [`node:${image.id}.attr.alt`]: { value: 'Die Über-uns-Seite' },
  })
  // English is unchanged.
  expect((translated.nodes['n-home-title'] as TextNode).text).toEqual(
    (before.nodes['n-home-title'] as TextNode).text,
  )
  expect(translated.nodes[image.id]!.attrs!.alt).toEqual({
    type: 'static',
    value: 'The About page',
  })
  // A rotating word translates in the Content tab; its icon stays the primary's.
  await canvas.locator('[data-lacuno-node="n-home-choice-kicker"]').click()
  await openInspectorTab(page, 'Content')
  // The Style tab shows the words too, locked.
  const word = page.getByLabel('Word 2', { exact: true }).and(page.locator(':enabled'))
  await word.fill('Teams')
  await word.blur()
  await saved()
  const words = await site()
  expect(words.translations.de!['node:n-home-choice-kicker.word.1']).toMatchObject({
    value: 'Teams',
  })
  expect((words.nodes['n-home-choice-kicker'] as TextNode).rotatingWords!.words[1]).toEqual({
    text: 'teams',
    icon: 'sparkles',
  })
  await page.getByRole('button', { name: 'Clear selection' }).click()
  // The rest of the page still reads English, dimmed.
  await expect
    .poll(() => canvas.locator('[data-lacuno-translation="missing"]').count())
    .toBeGreaterThan(0)
  await heading.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: path.join(root, '.lacuno/editor-preview/languages-canvas.png') })

  // Translations: counts, the missing ones, and one translated in place.
  await page.getByRole('button', { name: 'Translations', exact: true }).click()
  const counts = page.locator('.translations-counts')
  await expect.poll(() => counts.textContent()).toMatch(/^3 done · 0 outdated · \d+ missing$/)
  await page.getByLabel('Show', { exact: true }).selectOption('missing')
  const home = page.getByRole('region', { name: 'Home' })
  await expect.poll(() => home.getByText('Deine Website').count()).toBe(0)
  const name = home.locator('.translation-row').filter({ hasText: 'Page name' })
  await name.getByLabel('Translation').fill('Startseite')
  await name.getByLabel('Translation').press('Enter')
  await saved()
  await expect.poll(() => counts.textContent()).toMatch(/^4 done/)
  await expect.poll(() => name.count()).toBe(0)
  await page.locator('.sidebar-content').evaluate((element) => element.scrollTo(0, 0))
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/languages-translations.png'),
  })

  // A page's own slug: the German path changes, the English one stays.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await pageSettings(page, 'About')
  const pageDialog = page.getByRole('dialog', { name: 'Page settings' })
  const urlPath = pageDialog.getByLabel('URL path', { exact: true })
  expect(await urlPath.inputValue()).toBe('/de/about')
  expect(await pageDialog.getByLabel('Head code', { exact: true }).isDisabled()).toBe(true)
  await urlPath.fill('/de/ueber-uns')
  await pageDialog.getByRole('button', { name: 'Save page', exact: true }).click()
  await saved()
  await page.locator('.page-path').filter({ hasText: '/de/ueber-uns' }).waitFor()
  expect((await site()).pages['p-about']!.path).toBe('/about')

  // A CMS entry: its title translates, its URL field does not.
  await page.getByRole('button', { name: /^Article/ }).click()
  await page.getByRole('button', { name: 'Edit entry' }).click()
  const cms = page.getByRole('dialog', { name: 'CMS' })
  await cms.getByLabel('Title', { exact: true }).fill('Deine Website gehört dir')
  expect(await cms.getByLabel('URL', { exact: true }).isDisabled()).toBe(true)
  await cms.getByRole('button', { name: 'Save', exact: true }).click()
  await saved()
  const entry = (await site()).entries['col-posts']![0]!
  expect((await site()).translations.de![`entry:${entry.id}.f-title`]?.value).toBe(
    'Deine Website gehört dir',
  )
  expect(entry.fields['f-title']).toBe('Your website should belong to you')
  await page.keyboard.press('Escape')

  // Undo takes the translation back.
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect((await site()).translations.de![`entry:${entry.id}.f-title`]).toBeUndefined()

  // Removing German asks first and takes its translations with it.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toMatch(/^Remove Deutsch\? Its \d+ translations go with it\.$/)
    void dialog.accept()
  })
  await settings.getByRole('button', { name: 'Actions for de', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Remove' }).click()
  await saved()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => picker.count()).toBe(0)
  const after = await site()
  expect(after.site.locales).toEqual([{ code: 'en-US' }])
  expect(after.translations).toEqual({})
  await page.getByRole('button', { name: /^Home/ }).click()
  await expect.poll(() => heading.textContent()).toBe('Your website. Your rules.')
  expect(await canvas.locator('[data-lacuno-translation]').count()).toBe(0)
  expect(errors).toEqual([])
})
