import { useEffect, useState } from 'react'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The message a thrown value carries, or `fallback` when it is not an Error. */
export const message = (error: unknown, fallback = 'Something went wrong') =>
  error instanceof Error ? error.message : fallback

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = undefined
  }
  if (!response.ok) {
    const failure = data as { error?: string; message?: string } | undefined
    throw new ApiError(
      failure?.error ?? failure?.message ?? (response.statusText || 'Request failed'),
      response.status,
    )
  }
  return data as T
}

export type Config = {
  allowSignup: boolean
  setupRequired: boolean
  origin: string
  local: boolean
  /** The try editor: one site in the browser, and sign-up instead of publishing or AI apps. */
  try?: boolean
}

/** The server's config, read when a component that needs it mounts. */
export function useConfig() {
  const [config, setConfig] = useState<Config>()
  const [error, setError] = useState('')
  useEffect(() => {
    api<Config>('/api/config').then(setConfig, (error) => setError(message(error)))
  }, [])
  return { config, error }
}
