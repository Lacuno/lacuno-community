import { readFileSync } from 'node:fs'
import { assembleDocument, render } from '@lacuno/compiler/render'
import { generateStylesheet, LIVE_STATES } from '@lacuno/css'
import { fixtureDocument, parseDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { renderCanvas } from '../src/index.js'

it('keeps page instances opaque, exposes only the active definition, and preserves inherited styles', () => {
  const doc = parseDocument(
    JSON.parse(
      readFileSync(new URL('../../../templates/lacuno/lacuno.json', import.meta.url), 'utf8'),
    ),
  )
  const page = Object.values(doc.pages).find((page) => page.path === '/')!
  const instance = doc.nodes['n-home-header']!
  if (instance.type !== 'component') throw new Error('Expected a header instance')
  const component = doc.components[instance.component]!
  const before = structuredClone(doc)
  const normal = renderCanvas(doc, page, undefined, 'site-test').html
  expect(normal).toContain(`data-lacuno-node="${instance.id}"`)
  expect(normal).not.toContain(`data-lacuno-node="${component.root}"`)
  const editing = renderCanvas(doc, page, undefined, 'site-test', component.id).html
  expect(editing).toContain(`data-lacuno-node="${component.root}"`)
  expect(editing).not.toContain(`data-lacuno-node="${instance.id}"`)
  expect(editing).toMatch(/<body[^>]*class="[^"]+"/)
  expect(doc).toEqual(before)
  doc.components['cmp-alias'] = { id: 'cmp-alias', name: 'Alias', props: [], root: 'n-alias' }
  doc.nodes['n-alias'] = {
    id: 'n-alias',
    type: 'component',
    component: component.id,
    parent: null,
    classes: [],
    children: [],
  }
  instance.component = 'cmp-alias'
  const alias = renderCanvas(doc, page, undefined, 'site-test').html
  expect(alias).toContain(`data-lacuno-node="${instance.id}"`)
  expect(alias).not.toContain('data-lacuno-node="n-alias"')
})

it.each([
  ['fixture', fixtureDocument()],
  [
    'default template',
    parseDocument(
      JSON.parse(
        readFileSync(new URL('../../../templates/lacuno/lacuno.json', import.meta.url), 'utf8'),
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
        compiled.head += `\n<style>${generateStylesheet(doc, { assetUrl: (asset) => `/api/sites/site-test/assets/${asset.hash}` }).css}</style>`
        const canvas = renderCanvas(doc, page, entry, 'site-test')
        const normalized = canvas.html
          // Neither fixture embed nests a div.
          // An unstyled embed's wrapper is canvas-only; a styled one publishes without the marker.
          .replace(/<div data-lacuno-embed[^>]*>([\s\S]*?)<\/div>/g, '$1')
          .replace(/ data-lacuno-(embed|rich)/g, '')
          .replace(/ data-lacuno-node="[^"]*"/g, '')
          // The canvas lists the server's resized variants; a build lists Astro's.
          .replace(/ srcset="[^"]*"/g, '')
          // The canvas lets the browser size an image; a build takes the viewport.
          .replace(/ sizes="auto, 100vw"/g, ' sizes="100vw"')
          // Structural states emit both forms in the canvas: drop the forced sibling.
          .replace(/, \S+\[data-lc-state="[^"]*"\]/g, '')
          // Interaction states emit only the forced form: map it back to its real pseudo-class.
          .replace(/\[data-lc-state="([^"]+)"\]/g, (whole, state) =>
            LIVE_STATES.has(state) ? `:${state}` : whole,
          )
          .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n/, '')
        expect(normalized).toBe(assembleDocument(compiled))
        expect(canvas.html).toContain('data-lacuno-node=')
      }
    }
  },
)
