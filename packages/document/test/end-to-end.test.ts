import { assembleDocument, plainImageResolver, render } from '@miralo/compiler'
import { generateStylesheet } from '@miralo/css'
import { createEmptyDocument, fixtureDocument } from '@miralo/schema'
import { describe, expect, it } from 'vitest'
import { DocumentStore } from '../src/store.js'
import { fixtureOperations } from './fixture-operations.js'

describe('building the fixture from an empty document', () => {
  it('reproduces the fixture exactly and renders identically', async () => {
    const empty = createEmptyDocument('Fixture Co')
    const store = DocumentStore.inMemory(empty)
    const initialPage = Object.keys(empty.pages)[0] as string
    const ops = fixtureOperations(initialPage)
    const result = await store.apply({ expectedRevision: 0, operations: ops })
    expect(result.warnings).toEqual([])
    const built = { ...store.read().document, revision: 0 }
    const fixture = fixtureDocument()
    expect(built).toEqual(fixture)

    expect(generateStylesheet(built).css).toBe(generateStylesheet(fixture).css)
    const ctx = { resolveImage: plainImageResolver }
    for (const pageId of ['p-home', 'p-post'] as const) {
      const page = fixture.pages[pageId]!
      const entry = page.collection ? fixture.entries[page.collection]![0] : undefined
      expect(assembleDocument(render(built, built.pages[pageId]!, entry, ctx))).toBe(
        assembleDocument(render(fixture, page, entry, ctx)),
      )
    }
  })
})
