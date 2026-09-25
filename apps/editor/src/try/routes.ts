import {
  type DocumentStore,
  documentErrorResponse,
  type Persistence,
  stageUpload,
  UploadInput,
} from '@lacuno/document'
import { renderPreview } from '@lacuno/renderer'

/** The one site a visitor edits in the browser. */
export const TRY_SITE = 'try'

/** Stored asset bytes can be read back as well as written. */
export type AssetPersistence = Persistence & {
  getAsset(hash: string): Promise<Uint8Array<ArrayBuffer> | undefined>
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Answers the editor's API routes the way the server does, for the `try` site only. Anything that
 * is not one of those routes is undefined, so the caller can pass it on to the network.
 */
export async function handle(
  request: Request,
  store: Promise<DocumentStore>,
  persistence: AssetPersistence,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname}`
  try {
    if (route === 'GET /api/config')
      return json({
        allowSignup: false,
        setupRequired: false,
        origin: url.origin,
        local: false,
        try: true,
      })
    if (route === 'GET /api/auth/get-session')
      return json({ user: { id: 'visitor', name: 'Visitor', email: '' } })
    if (route === 'GET /api/sites') {
      const { document, revision } = (await store).read()
      return json({ sites: [{ id: TRY_SITE, name: document.site.name, revision }] })
    }
    if (route === 'POST /api/sites') return json({ error: 'Sign up to create more sites.' }, 403)
    const [, site, rest] = url.pathname.match(/^\/api\/sites\/([^/]+)\/(.+)$/) ?? []
    if (!site) return undefined
    if (site !== TRY_SITE) return json({ error: 'Site not found' }, 404)
    const siteRoute = `${request.method} ${rest}`
    if (siteRoute === 'GET document') return json((await store).read())
    if (siteRoute === 'POST document/apply')
      return json(await (await store).apply(await request.json()))
    if (siteRoute === 'GET preview') {
      const { document } = (await store).read()
      const { status, body } = renderPreview(
        document,
        TRY_SITE,
        Object.fromEntries(url.searchParams),
      )
      return json(body, status)
    }
    if (siteRoute === 'POST assets/upload') {
      const input = UploadInput.safeParse(await request.json().catch(() => null))
      if (!input.success) return json({ error: 'Invalid upload' }, 400)
      const bytes = Uint8Array.from(atob(input.data.data), (char) => char.charCodeAt(0))
      const { document } = (await store).read()
      const { status, body } = await stageUpload(document, persistence, input.data.name, bytes)
      return json(body, status)
    }
    const hash = siteRoute.match(/^GET assets\/([a-f0-9]{64})$/)?.[1]
    if (hash) {
      const asset = Object.values((await store).read().document.assets).find(
        (item) => item.hash === hash,
      )
      const bytes = asset && (await persistence.getAsset(hash))
      if (!bytes) return new Response('404 Not Found', { status: 404 })
      return new Response(bytes, {
        headers: {
          'Content-Type': asset.mime,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
      })
    }
    if (siteRoute === 'GET releases') return json({ enabled: false, releases: [] })
    if (siteRoute === 'GET connections') return json([])
    // No one else edits a browser site, so the stream opens and stays quiet.
    if (siteRoute === 'GET events')
      return new Response(new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
      })
    return undefined
  } catch (error) {
    const failure = documentErrorResponse(error)
    if (failure) return json(failure.body, failure.status)
    console.error(error)
    return json({ error: 'Internal server error' }, 500)
  }
}
