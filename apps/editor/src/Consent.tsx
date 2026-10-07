import { useEffect, useState } from 'react'
import { Brand } from './App.js'
import { api, message, take } from './api.js'

/** The signed authorization request an AI app sent the user here with. */
const query = () => location.search.slice(1)
const loopback = ['localhost', '127.0.0.1', '[::1]']

/** Asks the signed-in owner whether an AI app may edit the site its request names. */
export function Consent() {
  const [request, setRequest] = useState<{
    app: string
    site: string | null
    /** Where a web app returns after Allow; any app can pick its name, not its address. */
    returnsTo: string | null
  }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const params = new URLSearchParams(query())
    const siteId = params.get('resource')?.split('/mcp/')[1]
    Promise.all([
      api<{ client_name?: string }>(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(params.get('client_id') ?? '')}`,
      ),
      take<{ sites: { id: string; name: string }[] }>('/api/sites'),
    ])
      .then(([client, { sites }]) => {
        const { hostname } = new URL(params.get('redirect_uri') ?? '')
        setRequest({
          app: client.client_name ?? 'An app',
          site: sites.find((site) => site.id === siteId)?.name ?? null,
          returnsTo: loopback.includes(hostname) ? null : hostname,
        })
      })
      .catch((e) => setError(message(e)))
  }, [])
  async function answer(accept: boolean) {
    try {
      const { url } = await api<{ url: string }>('/api/auth/oauth2/consent', {
        accept,
        oauth_query: query(),
      })
      location.assign(url)
    } catch (e) {
      setError(message(e))
    }
  }
  return (
    <main className="loading">
      <div className="consent">
        <Brand />
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !request ? (
          <p className="muted">Loading…</p>
        ) : request.site ? (
          <>
            <p className="eyebrow">CONNECT YOUR AI</p>
            <h1>
              Allow {request.app} to edit {request.site}?
            </h1>
            {request.returnsTo && <p>You will return to {request.returnsTo}.</p>}
            <p className="muted">
              {request.app} will be able to read and change pages, styles and assets on this site
              until you disconnect it.
            </p>
            <button type="button" className="primary" onClick={() => answer(true)}>
              Allow <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="text-button" onClick={() => answer(false)}>
              Deny
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">CONNECT YOUR AI</p>
            <h1>{request.app} asked for a site that is not in your workspace.</h1>
            <button type="button" onClick={() => answer(false)}>
              Go back
            </button>
          </>
        )}
      </div>
    </main>
  )
}
