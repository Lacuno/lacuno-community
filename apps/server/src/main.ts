import path from 'node:path'
import { serve } from '@hono/node-server'
import { createServer } from './app.js'
import { readPort, root } from './environment.js'

const port = readPort(process.env.PORT, 3000)
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters')
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`
const gatewayIssuer = process.env.MIRALO_GATEWAY_ISSUER
const gatewaySecret = process.env.MIRALO_GATEWAY_SECRET
if (!!gatewayIssuer !== !!gatewaySecret)
  throw new Error('Gateway issuer and secret must be configured together')
const publishPort = readPort(process.env.MIRALO_PUBLISH_PORT, port + 1)
const publishBaseURL =
  process.env.MIRALO_PUBLISH_BASE_URL ??
  (new URL(baseURL).hostname === 'localhost' ? `http://localhost:${publishPort}` : undefined)
if (publishBaseURL && publishPort === port)
  throw new Error('Publishing requires a separate MIRALO_PUBLISH_PORT')
const server = await createServer({
  dataDir: path.resolve(root, process.env.MIRALO_DATA_DIR ?? 'data'),
  templateDir: path.resolve(root, process.env.MIRALO_TEMPLATE_DIR ?? 'templates/miralo'),
  baseURL,
  ...(gatewayIssuer && gatewaySecret
    ? { gateway: { issuer: gatewayIssuer, secret: gatewaySecret } }
    : {}),
  ...(publishBaseURL ? { publishBaseURL } : {}),
  secret,
  editorDir: path.join(root, 'apps/editor/dist'),
  allowSignup: process.env.MIRALO_ALLOW_SIGNUP === 'true',
})
const listener = serve(
  { fetch: server.app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' },
  (info) => {
    console.log(`Miralo API listening on port ${info.port}`)
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
