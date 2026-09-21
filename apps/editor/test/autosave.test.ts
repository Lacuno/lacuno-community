import type { Operation } from '@freeflow/document'
import { describe, expect, it } from 'vitest'
import { type AutosaveState, createAutosave } from '../src/autosave.js'

const edit = (value: string): Operation[] =>
  [{ type: 'node.update', id: 'n-title', text: { type: 'static', value } }] as Operation[]

/** A controllable save: each call parks until the test resolves it. */
function harness(state: Partial<AutosaveState> = {}) {
  const current: AutosaveState = {
    operations: edit('a'),
    key: 'a',
    enabled: true,
    busy: false,
    ...state,
  }
  const pending: ((ok: boolean) => void)[] = []
  const sent: string[] = []
  const failures: boolean[] = []
  const autosave = createAutosave(
    () => current,
    (operations) => {
      sent.push(JSON.stringify(operations))
      return new Promise<boolean>((resolve) => pending.push(resolve))
    },
    (failed) => failures.push(failed),
  )
  const settle = async (ok: boolean) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    pending.shift()?.(ok)
  }
  const type = (value: string) => {
    current.operations = edit(value)
    current.key = value
  }
  return { autosave, current, sent, failures, settle, type }
}

describe('createAutosave', () => {
  it('saves a pending edit once and skips it afterwards', async () => {
    const { autosave, sent, settle } = harness()
    const first = autosave.flush()
    await settle(true)
    expect(await first).toBe(true)
    expect(await autosave.flush()).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('waits while another save is in flight instead of reporting a failure', async () => {
    const { autosave, current, sent, failures, settle } = harness({ busy: true })
    const flushed = autosave.flush()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(sent).toHaveLength(0)
    current.busy = false
    await new Promise((resolve) => setTimeout(resolve, 30))
    await settle(true)
    expect(await flushed).toBe(true)
    expect(failures).not.toContain(true)
  })

  it('remembers a rejected edit so the timer does not resend it until retry', async () => {
    const { autosave, sent, failures, settle } = harness()
    const flushed = autosave.flush()
    await settle(false)
    expect(await flushed).toBe(false)
    expect(failures.at(-1)).toBe(true)
    expect(autosave.rejected('a')).toBe(true)
    autosave.retry()
    expect(autosave.rejected('a')).toBe(false)
    await settle(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sent).toHaveLength(2)
    expect(failures.at(-1)).toBe(false)
  })

  it('shares one request between overlapping flush calls', async () => {
    const { autosave, sent, settle } = harness()
    const first = autosave.flush()
    const second = autosave.flush()
    expect(second).toBe(first)
    await settle(true)
    await first
    expect(sent).toHaveLength(1)
  })

  it('keeps saving while edits keep arriving during a save', async () => {
    const { autosave, sent, settle, type } = harness()
    const flushed = autosave.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    type('b')
    await settle(true)
    await settle(true)
    expect(await flushed).toBe(true)
    expect(sent.map((batch) => JSON.parse(batch)[0].text.value)).toEqual(['a', 'b'])
  })

  it('does nothing while disabled or with nothing pending', async () => {
    const disabled = harness({ enabled: false })
    expect(await disabled.autosave.flush()).toBe(false)
    expect(disabled.sent).toHaveLength(0)
    const clean = harness({ operations: [], key: '[]' })
    expect(await clean.autosave.flush()).toBe(true)
    expect(clean.sent).toHaveLength(0)
  })
})
