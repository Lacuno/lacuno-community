import { describe, expect, it } from 'vitest'
import { catchUp, type SiteEvent, touchedNodes } from '../src/liveEvents.js'

const event = (revision: number): SiteEvent => ({
  revision,
  patches: [],
  actor: { kind: 'agent', app: 'Claude Code' },
  at: 0,
  summary: '1 change',
})
const revisions = ({ run, gap }: ReturnType<typeof catchUp>) => ({
  run: run.map((item) => item.revision),
  gap,
})

describe('catchUp', () => {
  it('applies the batch that follows the snapshot', () => {
    expect(revisions(catchUp([event(4)], 3))).toEqual({ run: [4], gap: false })
  })

  it('drains a queue in order after a save, skipping what the save already covers', () => {
    // Queued while the designer's save was in flight: their own batch 4, then an agent's 5 and 6.
    expect(revisions(catchUp([event(4), event(5), event(6)], 4))).toEqual({
      run: [5, 6],
      gap: false,
    })
  })

  it('leaves nothing to apply when the snapshot already covers every event', () => {
    expect(revisions(catchUp([event(2), event(3)], 3))).toEqual({ run: [], gap: false })
  })

  it('reports a gap when a revision is missing', () => {
    expect(revisions(catchUp([event(5)], 3))).toEqual({ run: [], gap: true })
    expect(revisions(catchUp([event(4), event(6)], 3))).toEqual({ run: [4], gap: true })
  })
})

describe('touchedNodes', () => {
  it('names each node a batch touches once, in order', () => {
    expect(
      touchedNodes([
        { op: 'set', path: ['nodes', 'n-new'], value: {} },
        { op: 'insert', path: ['nodes', 'n-body', 'children'], index: 0, value: 'n-new' },
        { op: 'set', path: ['nodes', 'n-new', 'text'], value: 'Hi' },
        { op: 'set', path: ['styles', 's-1'], value: {} },
      ]),
    ).toEqual(['n-new', 'n-body'])
  })
})
