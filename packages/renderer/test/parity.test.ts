import { readFileSync } from 'node:fs'
import { assembleDocument, render } from '@freeflow/compiler/render'
import { generateStylesheet } from '@freeflow/css'
import { fixtureDocument, parseDocument } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { renderCanvas } from '../src/index.js'

it.each([
  ['fixture', fixtureDocument()],
  [
    'default template',
    parseDocument(
      JSON.parse(
        readFileSync(new URL('../../../templates/freeflow/freeflow.json', import.meta.url), 'utf8'),
      ),
    ),
  ],
] as const)(
  'keeps %s compiler markup and generated CSS identical aside from canvas metadata and policy',
  (_name, doc) => {
    for (const page of Object.values(doc.pages)) {
      const entries = page.collection ? doc.entries[page.collection]! : [undefined]
      for (const entry of entries) {
        const compiled = render(doc, page, entry, {
          resolveImage: (asset) => ({
            src: `/api/sites/site-test/assets/${asset.hash}`,
            width: asset.width ?? 0,
            height: asset.height ?? 0,
          }),
          resolveAsset: (asset) => `/api/sites/site-test/assets/${asset.hash}`,
        })
        compiled.head += `\n<style>${generateStylesheet(doc, { assetUrl: (id) => `/api/sites/site-test/assets/${doc.assets[id]!.hash}` }).css}</style>`
        const canvas = renderCanvas(doc, page, entry, 'site-test')
        const normalized = canvas.html
          .replace(/ data-freeflow-node="[^"]*"/g, '')
          .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '')
        expect(normalized).toBe(assembleDocument(compiled))
        expect(canvas.html).toContain('data-freeflow-node=')
      }
    }
  },
)
