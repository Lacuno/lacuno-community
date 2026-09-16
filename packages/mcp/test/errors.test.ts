import { describe, expect, it } from 'vitest'
import { describeError } from '../src/errors.js'

describe('describeError', () => {
  it('falls back to kind unexpected for errors no tool throws on purpose', () => {
    const described = describeError(new TypeError('x'))
    expect(described.kind).toBe('unexpected')
    expect(described.message).toBe('x')
    expect(typeof described.stack).toBe('string')
  })
})
