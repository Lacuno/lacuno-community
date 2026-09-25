import path from 'node:path'
import { serve } from '@hono/node-server'
import Database from 'better-sqlite3'
import { readPort } from './environment.js'
import { PublicationReader } from './publication-reader.js'
import { publishedApp } from './published.js'

const base = process.env.LACUNO_PUBLISH_BASE_URL
if (!base) throw new Error('LACUNO_PUBLISH_BASE_URL is required')
const port = readPort(process.env.LACUNO_PUBLISH_PORT, 3001)
const directory = path.resolve(process.env.LACUNO_DATA_DIR ?? 'data')
const sqlite = new Database(path.join(directory, 'lacuno.sqlite'), {
  readonly: true,
  fileMustExist: true,
})
const reader = new PublicationReader(sqlite, directory, base)
// Fail startup for unsupported databases. Never migrate or start a build queue here.
sqlite.prepare('SELECT site_id,target,release_id FROM publications LIMIT 1').all()
if (process.argv[2] === '--list') {
  console.log(JSON.stringify(reader.publications()))
  sqlite.close()
} else {
  const server = serve({
    fetch: publishedApp(reader).fetch,
    port,
    hostname: process.env.HOST ?? '127.0.0.1',
  })
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      server.close(() => sqlite.close())
      if ('closeIdleConnections' in server) server.closeIdleConnections()
    })
}
