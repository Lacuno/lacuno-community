import type { Operation } from '@miralo/document'
import { useEffect, useRef, useState } from 'react'
import { createAutosave } from './autosave.js'

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
  const current = useRef({ operations, key, enabled, busy, save, dirty })
  current.current = { operations, key, enabled, busy, save, dirty }
  const [hasFailed, setHasFailed] = useState(false)
  const autosave = useRef<ReturnType<typeof createAutosave> | null>(null)
  autosave.current ??= createAutosave(
    () => current.current,
    (pending) => current.current.save(pending),
    setHasFailed,
  )
  const { flush, retry, rejected } = autosave.current
  useEffect(() => {
    if (!enabled || busy || rejected(key)) return
    const timer = setTimeout(() => void flush(), 400)
    return () => clearTimeout(timer)
  }, [key, enabled, busy, flush, rejected])
  useDirtyChanged(dirty, dirtyChanged)
  useEffect(
    () => registerFlush?.(async () => !current.current.dirty || flush()),
    [registerFlush, flush],
  )
  return { flush, hasFailed, retry }
}
