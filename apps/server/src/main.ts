import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createServer } from './app.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
try {
  loadEnvFile(path.join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters')
const server = await createServer({
  dataDir: path.resolve(root, process.env.FREEFLOW_DATA_DIR ?? 'data'),
  templateDir: path.resolve(root, process.env.FREEFLOW_TEMPLATE_DIR ?? 'templates/freeflow'),
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`,
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
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    listener.close(() => {
      server.close()
    })
    if ('closeIdleConnections' in listener) listener.closeIdleConnections()
  })
}
