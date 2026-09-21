import { useEffect, useRef, useState } from 'react'
import type { EditOperation } from './history.js'

/** Serialize edits, group typing into one history step, and flush before navigation. */
export function useAutosave(
  operations: EditOperation[],
  enabled: boolean,
  busy: boolean,
  save: (operations: EditOperation[]) => Promise<boolean>,
) {
  const key = JSON.stringify(operations)
  const current = useRef({ operations, enabled, save, key, busy })
  current.current = { operations, enabled, save, key, busy }
  const request = useRef<Promise<boolean> | null>(null)
  const saved = useRef('')
  const failed = useRef('')
  const [hasFailed, setHasFailed] = useState(false)
  const drain = async (): Promise<boolean> => {
    for (;;) {
      const next = current.current
      if (!next.enabled) return false
      if (!next.operations.length || next.key === saved.current) return true
      // Another save is in flight; wait for it, because a refused save is not a failed save.
      if (next.busy) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        continue
      }
      setHasFailed(false)
      const success = await next.save(next.operations)
      if (!success) {
        failed.current = next.key
        setHasFailed(true)
        return false
      }
      saved.current = next.key
      failed.current = ''
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const flush = (): Promise<boolean> => {
    if (!request.current)
      request.current = drain().finally(() => {
        request.current = null
      })
    return request.current
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    if (!enabled || busy || key === '[]' || key === failed.current) return
    const timer = setTimeout(() => {
      void flushRef.current()
    }, 400)
    return () => clearTimeout(timer)
  }, [key, enabled, busy])
  return {
    flush,
    hasFailed,
    retry: () => {
      failed.current = ''
      void flushRef.current()
    },
  }
}
