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

export const unreachable = 'Lacuno cannot be reached right now. Please try again in a moment.'

/** No answer, or a server or proxy error: worth asking again later. */
export const transient = (error: unknown) => !(error instanceof ApiError) || error.status >= 500

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const send = () =>
    fetch(path, {
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
  let response = await send()
  // A workspace that is starting or stopping asks to come back later: once, after that delay.
  const delay = Number(response.headers.get('retry-after'))
  if (response.status === 503 && delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    response = await send()
  }
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
      failure?.error ??
        failure?.message ??
        // A proxy's own answer while the server restarts, such as "Bad Gateway".
        ([502, 503, 504].includes(response.status)
          ? unreachable
          : response.statusText || 'Request failed'),
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
