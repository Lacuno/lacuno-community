import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, api } from '../src/api.js'

afterEach(() => vi.unstubAllGlobals())

const responds = (body: string, init?: ResponseInit) =>
  vi.stubGlobal('fetch', async () => new Response(body, init))

it('reports the status of a non-json failure and the message of a json one', async () => {
  responds('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' })
  await expect(api('/api/sites')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  responds('', { status: 500 })
  await expect(api('/api/sites')).rejects.toBeInstanceOf(ApiError)
  responds(JSON.stringify({ error: 'Unknown site' }), { status: 404 })
  await expect(api('/api/sites')).rejects.toMatchObject({ status: 404, message: 'Unknown site' })
  responds(JSON.stringify({ revision: 3 }))
  expect(await api('/api/sites')).toEqual({ revision: 3 })
})
