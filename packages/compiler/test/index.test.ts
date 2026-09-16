import { describe, expect, it } from 'vitest'

describe('index entry point', () => {
  it('does not export build or writeFixtureSite, so importing it never loads Astro or sharp', async () => {
    const mod = await import('../src/index.js')
    expect(Object.keys(mod)).not.toContain('build')
    expect(Object.keys(mod)).not.toContain('writeFixtureSite')
  })

  it('exports build and writeFixtureSite from the build entry point', async () => {
    const mod = await import('../src/entry-build.js')
    expect(Object.keys(mod)).toContain('build')
    expect(Object.keys(mod)).toContain('writeFixtureSite')
  })
})
