import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuthTables } from 'better-auth/db'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { AUTH_TABLES } from '../src/app.js'
import { authOptions } from '../src/auth.js'

async function freePort() {
  const server = createTcpServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

it('starts a gateway runtime without Better Auth or the MCP SDK and loads Better Auth on first use', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-lazy-'))
  const log = path.join(dir, 'modules.log')
  // Records every module the server process loads, in the loader's own thread.
  const hooks = `import { appendFileSync } from 'node:fs'
export async function load(url, context, next) {
  appendFileSync(${JSON.stringify(log)}, url + '\\n')
  return next(url, context)
}`
  const register = `import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}))`
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  let child: ChildProcess | undefined
  try {
    child = spawn(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(register)}`,
        fileURLToPath(new URL('../dist/main.js', import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          PORT: String(port),
          HOST: '127.0.0.1',
          LACUNO_DATA_DIR: path.join(dir, 'data'),
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: 'lazy-start-test-secret-7d1f0c2b9e4a4f6d',
          LACUNO_GATEWAY_ISSUER: 'http://cloud.test',
          LACUNO_GATEWAY_SECRET: 'lazy-start-gateway-secret-0a6c3e8f51d24b97',
          LACUNO_PUBLISH_BASE_URL: 'http://{site}.sites.test',
          LACUNO_PUBLISH_PORT: String(await freePort()),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    await expect.poll(() => output, { timeout: 15_000 }).toContain('Lacuno API listening')
    expect((await fetch(`${origin}/health`)).status).toBe(200)
    const loaded = () => readFile(log, 'utf8')
    // Neither Better Auth nor the MCP SDK, which @lacuno/mcp imports, loads at start.
    expect(await loaded()).not.toMatch(/better-auth|@modelcontextprotocol/)
    // The migrations ran in their own process and left their tables.
    const sqlite = new Database(path.join(dir, 'data', 'lacuno.sqlite'), { readonly: true })
    expect(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE name='oauthClient'").get(),
    ).toBeTruthy()
    sqlite.close()

    const metadata = await fetch(`${origin}/.well-known/oauth-authorization-server`)
    expect(metadata.status).toBe(200)
    expect(await loaded()).toMatch(/better-auth/)
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    await rm(dir, { recursive: true, force: true })
  }
})

it('names a change of Better Auth’s tables in AUTH_TABLES, so existing databases migrate', () => {
  const sqlite = new Database(':memory:')
  const tables = getAuthTables(
    authOptions({ sqlite, origin: 'http://localhost', secret: 'x'.repeat(32), signUp: false }),
  )
  sqlite.close()
  const digest = createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, 16)
  // When the digest changes, bump AUTH_TABLES in app.ts and record both here.
  expect({ AUTH_TABLES, digest }).toEqual({ AUTH_TABLES: 1, digest: '73218d213305b3ff' })
})
