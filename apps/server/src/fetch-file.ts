import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { InputError } from '@lacuno/mcp'

/** The editor's upload limit, which a downloaded file meets too. */
const LIMIT = 10 * 1024 * 1024
const REDIRECTS = 5
const redirect = [301, 302, 303, 307, 308]

/** Only https on the default port, without credentials or fragment, up to 2048 characters. */
function allowed(value: string) {
  if (value.length > 2048 || value.includes('#')) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
  } catch {
    return false
  }
}

/** Why a download failed, from the direct fetcher's error or the relay's refusal code. */
function reason(error: unknown, signal: AbortSignal) {
  const text = error instanceof Error ? error.message : ''
  if (signal.aborted || text === 'timeout') return 'it took longer than 30 seconds'
  if (text.includes('public-routable') || text === 'private_address')
    return 'it is not a public address'
  if (text === 'too_large') return 'it is larger than 10 MB'
  if (text === 'content_type') return 'it is not an image, video or font'
  if (text === 'storage_full') return 'this workspace has used all the storage in its plan'
  if (text === 'rate_limited') return 'too many downloads; wait a minute'
  return 'it could not be reached'
}

/**
 * Downloads a file for an AI app: https on the default port, at most 5 redirects, 10 MB and 30
 * seconds. `get` fetches one hop without following redirects and reaches only public addresses,
 * pinning the address it checked against DNS rebinding: the Node fetcher here, Cloud's relay behind
 * a gateway. Every redirect's target goes through both checks again.
 */
export async function fetchFile(
  url: string,
  get: ClientMetadataResourceFetch = fetchClientMetadataResource,
): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(30_000)
  let at = url
  for (let hop = 0; hop <= REDIRECTS; hop++) {
    if (!allowed(at)) throw new InputError(`${at} is not an https address on the default port`)
    let response: Response
    try {
      response = await get(at, { headers: { accept: '*/*' }, signal })
    } catch (error) {
      throw new InputError(`Could not download ${url}: ${reason(error, signal)}.`)
    }
    const location = response.headers.get('location')
    if (redirect.includes(response.status) && location) {
      await response.body?.cancel()
      at = new URL(location, at).href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new InputError(`Could not download ${url}: it answered ${response.status}.`)
    }
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body?.getReader()
    try {
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > LIMIT) {
          reader.cancel().catch(() => {})
          throw new Error('too_large')
        }
        chunks.push(value)
      }
    } catch (error) {
      throw new InputError(`Could not download ${url}: ${reason(error, signal)}.`)
    }
    return new Uint8Array(Buffer.concat(chunks))
  }
  throw new InputError(`Could not download ${url}: more than ${REDIRECTS} redirects.`)
}
