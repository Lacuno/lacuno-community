import { useEffect, useState } from 'react'
import { api, message } from './api.js'

/** The signed authorization request an AI app sent the user here with. */
const query = () => location.search.slice(1)

/** Asks the signed-in owner whether an AI app may edit the site its request names. */
export function Consent() {
  const [request, setRequest] = useState<{ app: string; site: string | null }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const params = new URLSearchParams(query())
    const siteId = params.get('resource')?.split('/mcp/')[1]
    Promise.all([
      api<{ client_name?: string }>(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(params.get('client_id') ?? '')}`,
      ),
      api<{ sites: { id: string; name: string }[] }>('/api/sites'),
    ])
      .then(([client, { sites }]) =>
        setRequest({
          app: client.client_name ?? 'An app',
          site: sites.find((site) => site.id === siteId)?.name ?? null,
        }),
      )
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
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !request ? (
        <p>Loading…</p>
      ) : (
        <>
          <h1>
            {request.site
              ? `Allow ${request.app} to edit ${request.site}?`
              : `${request.app} asked for a site that is not in your workspace.`}
          </h1>
          <div className="row">
            {request.site && (
              <button type="button" className="primary" onClick={() => answer(true)}>
                Allow
              </button>
            )}
            <button type="button" onClick={() => answer(false)}>
              Deny
            </button>
          </div>
        </>
      )}
    </main>
  )
}
