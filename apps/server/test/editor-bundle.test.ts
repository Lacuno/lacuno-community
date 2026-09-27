import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// The editor's Content Security Policy has no 'unsafe-eval': code built from strings would throw
// in production and leave the editor blank, so the built bundle must not contain any (the
// minifier writes `new Function(` as `Function(`). Zod's probe for whether it may compile, which
// catches the refusal, is the one allowed use.
it('builds the editor without eval or new Function', () => {
  const assets = new URL('../../editor/dist/assets/', import.meta.url)
  const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'))
  expect(scripts.length).toBeGreaterThan(0)
  for (const file of scripts)
    expect(
      readFileSync(new URL(file, assets), 'utf8').replace('try{return Function(``),!0}catch', ''),
      file,
    ).not.toMatch(/\bFunction\s*\(|\beval\s*\(/)
})
