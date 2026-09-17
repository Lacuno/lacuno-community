import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each(['source', 'bundle'])(
  'persists a signed-in HTTP edit across a %s server process restart',
  async (entry) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-process-'))
    const reservation = createTcpServer().listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const port = address.port
    await new Promise<void>((resolve) => reservation.close(() => resolve()))
    const origin = `http://127.0.0.1:${port}`
    let child: ChildProcess | undefined
    let output = ''
    async function start() {
      output = ''
      const processChild = spawn(
        process.execPath,
        entry === 'source'
          ? ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))]
          : [fileURLToPath(new URL('../dist/main.js', import.meta.url))],
        {
          env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            FREEFLOW_DATA_DIR: dir,
            BETTER_AUTH_URL: origin,
            BETTER_AUTH_SECRET: 'process-test-secret-4c70d141a6994fc4a842',
            FREEFLOW_ALLOW_SIGNUP: 'true',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      child = processChild
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10_000)
        processChild.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        processChild.once('exit', (code) => {
          clearTimeout(timeout)
          reject(new Error(`Startup exited ${code}: ${output}`))
        })
        processChild.stderr?.on('data', (chunk) => {
          output += String(chunk)
        })
        processChild.stdout?.on('data', (chunk) => {
          output += String(chunk)
          if (output.includes('Freeflow API listening')) {
            clearTimeout(timeout)
            resolve()
          }
        })
      })
    }
    async function stop() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timeout = setTimeout(() => child?.kill('SIGKILL'), 5000)
      try {
        await exited
      } finally {
        clearTimeout(timeout)
      }
      child = undefined
    }
    const post = (route: string, body: unknown, cookie = '') =>
      fetch(`${origin}${route}`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    try {
      await start()
      expect((await fetch(`${origin}/health`)).status).toBe(200)
      const credentials = { email: 'process@example.test', password: 'real-process-test-password' }
      expect(
        (await post('/api/auth/sign-up/email', { ...credentials, name: 'Process' })).status,
      ).toBe(200)
      const login = await post('/api/auth/sign-in/email', credentials)
      expect(login.status).toBe(200)
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ')
      const created = await post('/api/sites', { name: 'Process site' }, cookie)
      expect(created.status).toBe(201)
      const { id } = (await created.json()) as { id: string }
      expect(
        (
          await post(
            `/api/sites/${id}/document/apply`,
            {
              expectedRevision: 0,
              operations: [{ type: 'site.update', name: 'Survived process restart' }],
            },
            cookie,
          )
        ).status,
      ).toBe(200)
      await stop()
      await start()
      const document = await fetch(`${origin}/api/sites/${id}/document`, { headers: { cookie } })
      expect(document.status).toBe(200)
      expect(await document.json()).toMatchObject({
        revision: 1,
        document: { site: { name: 'Survived process restart' } },
      })
    } finally {
      await stop()
      await rm(dir, { recursive: true, force: true })
    }
  },
)
