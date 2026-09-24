import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
export async function auditStyles(page: Page, root: string) {
  const before = JSON.parse(await readFile(root + '/.freeflow/review/css-before.json', 'utf8'))
  const toolbar = await readFile(root + '/apps/editor/src/text-toolbar.css', 'utf8')
  const after =
    toolbar +
    (await readFile(root + '/apps/editor/src/style.css', 'utf8')) +
    (await readFile(root + '/apps/editor/src/editor-chrome.css', 'utf8'))
  const baseline = toolbar + before.base + before.chrome
  for (const width of [1500, 1100]) {
    await page.setViewportSize({ width, height: 1000 })
    const differences = await page.evaluate(
      ({ baseline, after }) => {
        const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]'))
        for (const link of links) link.disabled = true
        const style = document.createElement('style')
        document.head.append(style)
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>('.editor, .editor *'),
        ).filter((el) => !['STYLE', 'SCRIPT'].includes(el.tagName) && el.checkVisibility())
        const properties = [
          'display',
          'width',
          'height',
          'min-width',
          'min-height',
          'padding-top',
          'padding-right',
          'padding-bottom',
          'padding-left',
          'margin-top',
          'margin-right',
          'margin-bottom',
          'margin-left',
          'color',
          'background-color',
          'font-size',
          'font-weight',
          'line-height',
          'border-top-width',
          'border-right-width',
          'gap',
          'grid-template-columns',
          'flex-direction',
          'overflow-x',
          'overflow-y',
        ]
        const snapshot = () =>
          elements.map((el) =>
            properties.map((property) => getComputedStyle(el).getPropertyValue(property)),
          )
        style.textContent = baseline
        const previous = snapshot()
        style.textContent = after
        const current = snapshot()
        const differences: string[] = []
        for (let i = 0; i < elements.length; i++)
          for (let p = 0; p < properties.length; p++)
            if (previous[i]![p] !== current[i]![p])
              differences.push(
                elements[i]!.tagName +
                  '.' +
                  elements[i]!.className +
                  ': ' +
                  properties[p] +
                  ' ' +
                  previous[i]![p] +
                  ' -> ' +
                  current[i]![p],
              )
        style.remove()
        for (const link of links) link.disabled = false
        return differences
      },
      { baseline, after },
    )
    if (differences.length)
      throw new Error('CSS differences at ' + width + ':\n' + differences.slice(0, 40).join('\n'))
  }
  await page.setViewportSize({ width: 1500, height: 1000 })
}
