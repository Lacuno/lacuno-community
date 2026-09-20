import path from 'node:path'
import { serve } from '@hono/node-server'
import { createServer } from './app.js'
import { root } from './environment.js'

const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters')
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`
const gatewayIssuer = process.env.FREEFLOW_GATEWAY_ISSUER
const gatewaySecret = process.env.FREEFLOW_GATEWAY_SECRET
if (!!gatewayIssuer !== !!gatewaySecret)
  throw new Error('Gateway issuer and secret must be configured together')
const publishPort = Number(process.env.FREEFLOW_PUBLISH_PORT ?? port + 1)
const publishBaseURL =
  process.env.FREEFLOW_PUBLISH_BASE_URL ??
  (new URL(baseURL).hostname === 'localhost' ? `http://localhost:${publishPort}` : undefined)
if (
  publishBaseURL &&
  (!Number.isInteger(publishPort) || publishPort < 1 || publishPort > 65535 || publishPort === port)
)
  throw new Error('Publishing requires a valid separate FREEFLOW_PUBLISH_PORT')
const server = await createServer({
  dataDir: path.resolve(root, process.env.FREEFLOW_DATA_DIR ?? 'data'),
  templateDir: path.resolve(root, process.env.FREEFLOW_TEMPLATE_DIR ?? 'templates/freeflow'),
  baseURL,
  ...(gatewayIssuer && gatewaySecret
    ? { gateway: { issuer: gatewayIssuer, secret: gatewaySecret } }
    : {}),
  ...(publishBaseURL ? { publishBaseURL } : {}),
  secret,
  editorDir: path.join(root, 'apps/editor/dist'),
  allowSignup: process.env.FREEFLOW_ALLOW_SIGNUP === 'true',
})
const listener = serve(
  { fetch: server.app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' },
  (info) => {
    console.log(`Freeflow API listening on port ${info.port}`)
  },
)
const publishedListener = server.published
  ? serve(
      {
        fetch: server.published.fetch,
        port: publishPort,
        hostname: process.env.HOST ?? '127.0.0.1',
      },
      () => console.log(`Published sites listening on port ${publishPort}`),
    )
  : undefined
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    publishedListener?.close()
    if (publishedListener && 'closeIdleConnections' in publishedListener)
      publishedListener.closeIdleConnections()
    listener.close(() => {
      server.close()
    })
    if ('closeIdleConnections' in listener) listener.closeIdleConnections()
  })
}
