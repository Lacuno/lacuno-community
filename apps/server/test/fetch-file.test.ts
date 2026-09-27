import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import { describe, expect, it } from 'vitest'
import { fetchFile } from '../src/fetch-file.js'

const moved = (location: string) => new Response(null, { status: 302, headers: { location } })

/** A fetcher that answers the listed addresses and hands any other to the real Node fetcher. */
function web(answers: Record<string, () => Response>) {
  const seen: string[] = []
  const get: ClientMetadataResourceFetch = async (input, init) => {
    const url = String(input)
    seen.push(url)
    return answers[url]?.() ?? fetchClientMetadataResource(url, init)
  }
  return { get, seen }
}

describe('downloading a file for an AI app', () => {
  it('follows redirects to the file', async () => {
    const { get, seen } = web({
      'https://images.example/a': () => moved('/b'),
      'https://images.example/b': () => moved('https://cdn.example/c.png'),
      'https://cdn.example/c.png': () => new Response('bytes'),
    })
    expect(Buffer.from(await fetchFile('https://images.example/a', get)).toString()).toBe('bytes')
    expect(seen).toEqual([
      'https://images.example/a',
      'https://images.example/b',
      'https://cdn.example/c.png',
    ])
  })

  it('reaches only public https addresses, also after a redirect', async () => {
    const { get } = web({
      'https://images.example/loopback': () => moved('https://127.0.0.1/a.png'),
      'https://images.example/metadata': () => moved('https://169.254.169.254/latest'),
      'https://images.example/plain': () => moved('http://images.example/a.png'),
      'https://images.example/port': () => moved('https://images.example:8443/a.png'),
    })
    for (const url of [
      'https://127.0.0.1/a.png',
      'https://10.1.2.3/a.png',
      'https://localhost/a.png',
      'https://images.example/loopback',
      'https://images.example/metadata',
    ])
      await expect(fetchFile(url, get), url).rejects.toThrow('it is not a public address')
    // The fetcher looks bracketed IPv6 literals up as names, which never resolve.
    for (const url of ['https://[::1]/a.png', 'https://[::ffff:127.0.0.1]/a.png'])
      await expect(fetchFile(url, get), url).rejects.toThrow('Could not download')
    for (const url of [
      'http://images.example/a.png',
      'file:///etc/passwd',
      'https://user:secret@images.example/a.png',
      'https://images.example/plain',
      'https://images.example/port',
    ])
      await expect(fetchFile(url, get), url).rejects.toThrow('is not an https address')
  })

  it('refuses more than 5 redirects, more than 10 MB and error answers', async () => {
    const { get } = web({
      'https://images.example/loop': () => moved('https://images.example/loop'),
      'https://images.example/huge': () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)),
      'https://images.example/missing': () => new Response('no', { status: 404 }),
    })
    await expect(fetchFile('https://images.example/loop', get)).rejects.toThrow('more than 5')
    await expect(fetchFile('https://images.example/huge', get)).rejects.toThrow('larger than 10 MB')
    await expect(fetchFile('https://images.example/missing', get)).rejects.toThrow('answered 404')
  })

  it("words the relay's refusals", async () => {
    for (const [code, why] of [
      ['private_address', 'it is not a public address'],
      ['content_type', 'it is not an image, video or font'],
      ['storage_full', 'all the storage in its plan'],
      ['timeout', 'longer than 30 seconds'],
    ])
      await expect(
        fetchFile('https://images.example/a.png', async () => {
          throw new TypeError(code)
        }),
      ).rejects.toThrow(why)
  })
})
