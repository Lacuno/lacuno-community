import { serve } from '@hono/node-server'
import { readPort } from './environment.js'
import { screenshotService } from './screenshot-service.js'

const slots = Number(process.env.LACUNO_SCREENSHOT_SLOTS ?? 2)
if (!Number.isInteger(slots) || slots < 1)
  throw new Error(`Invalid LACUNO_SCREENSHOT_SLOTS ${slots}`)
const app = screenshotService({
  slots,
  secret: process.env.LACUNO_SCREENSHOT_SECRET,
  wait: 20_000,
  deadline: 30_000,
  stuck: 60_000,
})
const server = serve(
  {
    fetch: app.fetch,
    port: readPort(process.env.PORT, 3000),
    hostname: process.env.HOST ?? '127.0.0.1',
  },
  (info) => console.log(`Screenshots listening on port ${info.port}`),
)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    // Exiting also ends Chromium.
    server.close(() => process.exit())
    if ('closeIdleConnections' in server) server.closeIdleConnections()
  })
