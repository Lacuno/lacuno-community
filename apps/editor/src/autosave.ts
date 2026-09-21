import type { Operation } from '@freeflow/document'

export type AutosaveState = {
  operations: Operation[]
  /** Identifies the pending edit; the same key is never saved twice. */
  key: string
  enabled: boolean
  /** Another save is in flight, so a save now would be refused rather than fail. */
  busy: boolean
}

/**
 * Saves whatever `read()` reports, one request at a time, until nothing is pending. A refusal
 * while busy waits and retries; a rejection by the server is remembered so the same edit is
 * not resent until `retry`.
 */
export function createAutosave(
  read: () => AutosaveState,
  save: (operations: Operation[]) => Promise<boolean>,
  onFailed: (failed: boolean) => void = () => {},
) {
  let request: Promise<boolean> | null = null
  let saved = ''
  let failed = ''
  const drain = async (): Promise<boolean> => {
    for (;;) {
      const { enabled, operations, key, busy } = read()
      if (!enabled) return false
      if (!operations.length || key === saved) return true
      if (busy) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        continue
      }
      onFailed(false)
      if (!(await save(operations))) {
        failed = key
        onFailed(true)
        return false
      }
      saved = key
      failed = ''
      // Let a keystroke that landed during the save update the state before looking again.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const flush = () => {
    request ??= drain().finally(() => {
      request = null
    })
    return request
  }
  return {
    flush,
    retry() {
      failed = ''
      void flush()
    },
    /** True while `key` is the edit the server rejected, so the timer must not resend it. */
    rejected: (key: string) => key === failed,
  }
}
