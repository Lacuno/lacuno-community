import type { Operation } from '@freeflow/document'
import { useEffect, useRef, useState } from 'react'

const ignore = () => {}

/** Tell the editor about unsaved edits in this panel. */
export function useDirtyChanged(dirty: boolean, dirtyChanged: (dirty: boolean) => void) {
  useEffect(() => {
    dirtyChanged(dirty)
  }, [dirty, dirtyChanged])
}

/** Serialize edits, group typing into one history step, and flush before navigation. */
export function useAutosave(
  operations: Operation[],
  enabled: boolean,
  busy: boolean,
  save: (operations: Operation[]) => Promise<boolean>,
  panel?: {
    dirty: boolean
    dirtyChanged?: (dirty: boolean) => void
    registerFlush?: (flush: () => Promise<boolean>) => () => void
  },
) {
  const { dirty = false, dirtyChanged = ignore, registerFlush } = panel ?? {}
  const key = JSON.stringify(operations)
  const current = useRef({ operations, enabled, save, key, busy, dirty })
  current.current = { operations, enabled, save, key, busy, dirty }
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
    if (!enabled || busy || key === failed.current) return
    const timer = setTimeout(() => {
      void flushRef.current()
    }, 400)
    return () => clearTimeout(timer)
  }, [key, enabled, busy])
  useDirtyChanged(dirty, dirtyChanged)
  useEffect(
    () => registerFlush?.(async () => !current.current.dirty || flushRef.current()),
    [registerFlush],
  )
  return {
    flush,
    hasFailed,
    retry: () => {
      failed.current = ''
      void flushRef.current()
    },
  }
}
