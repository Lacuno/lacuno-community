import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, api, unreachable } from '../src/api.js'

afterEach(() => vi.unstubAllGlobals())

const responds = (body: string, init?: ResponseInit) =>
  vi.stubGlobal('fetch', async () => new Response(body, init))

it('reports the status of a non-json failure and the message of a json one', async () => {
  responds('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })
  await expect(api('/api/sites')).rejects.toMatchObject({ status: 502, message: unreachable })
  responds('', { status: 504, statusText: 'Gateway Timeout' })
  await expect(api('/api/sites')).rejects.toMatchObject({ status: 504, message: unreachable })
  responds(JSON.stringify({ error: 'The file could not be stored.' }), { status: 502 })
  await expect(api('/api/sites')).rejects.toMatchObject({
    message: 'The file could not be stored.',
  })
  responds('', { status: 500 })
  await expect(api('/api/sites')).rejects.toBeInstanceOf(ApiError)
  responds(JSON.stringify({ error: 'Unknown site' }), { status: 404 })
  await expect(api('/api/sites')).rejects.toMatchObject({ status: 404, message: 'Unknown site' })
  responds(JSON.stringify({ revision: 3 }))
  expect(await api('/api/sites')).toEqual({ revision: 3 })
})

it('retries a 503 with Retry-After once, after that delay', async () => {
  vi.useFakeTimers()
  try {
    const starting = () =>
      new Response(JSON.stringify({ error: 'Starting' }), {
        status: 503,
        headers: { 'retry-after': '2' },
      })
    const answers = [starting(), new Response(JSON.stringify({ revision: 4 }))]
    const calls = vi.fn(async () => answers.shift() ?? starting())
    vi.stubGlobal('fetch', calls)
    const result = api('/api/sites', { expectedRevision: 3 })
    await vi.advanceTimersByTimeAsync(1999)
    expect(calls).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual({ revision: 4 })
    expect(calls).toHaveBeenCalledTimes(2)

    // Only once: a second 503 is the answer, and one without Retry-After is not retried.
    const again = expect(api('/api/sites')).rejects.toMatchObject({ status: 503 })
    await vi.advanceTimersByTimeAsync(2000)
    await again
    expect(calls).toHaveBeenCalledTimes(4)
    responds(JSON.stringify({ error: 'Maintenance' }), { status: 503 })
    await expect(api('/api/sites')).rejects.toMatchObject({ status: 503 })
  } finally {
    vi.useRealTimers()
  }
})
