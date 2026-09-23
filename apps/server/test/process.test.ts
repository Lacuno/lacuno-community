import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
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
    const publicReservation = createTcpServer().listen(0, '127.0.0.1')
    await once(publicReservation, 'listening')
    const publicAddress = publicReservation.address()
    if (!publicAddress || typeof publicAddress === 'string') throw new Error('No publishing port')
    const publicPort = publicAddress.port
    await new Promise<void>((resolve) => publicReservation.close(() => resolve()))
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
            FREEFLOW_PUBLISH_BASE_URL: `http://localhost:${publicPort}`,
            FREEFLOW_PUBLISH_PORT: String(publicPort),
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
      const history = async () =>
        (await (
          await fetch(`${origin}/api/sites/${id}/releases`, { headers: { cookie } })
        ).json()) as {
          publishedId: string | null
          releases: { status: string; error: string | null }[]
        }
      if (entry === 'bundle') {
        const browser = await chromium.launch({ headless: true })
        try {
          const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
          await page.goto(`${origin}/?site=${id}`)
          await page.getByLabel('Email', { exact: true }).fill(credentials.email)
          await page.getByLabel('Password', { exact: true }).fill(credentials.password)
          await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          await page.getByRole('button', { name: 'Publish', exact: true }).click()
          await page.getByRole('button', { name: 'Publish v1', exact: true }).click()
          await page.getByRole('link', { name: 'Open published site' }).waitFor({ timeout: 20000 })
          const href = await page
            .getByRole('link', { name: 'Open published site' })
            .getAttribute('href')
          expect(href).toBe(`http://${id}.localhost:${publicPort}`)
          await page.screenshot({
            path: fileURLToPath(
              new URL('../../../.freeflow/editor-preview/publishing.png', import.meta.url),
            ),
          })
          await page.setViewportSize({ width: 1100, height: 800 })
          await page.screenshot({
            path: fileURLToPath(
              new URL('../../../.freeflow/editor-preview/publishing-narrow.png', import.meta.url),
            ),
          })
          const live = await browser.newPage()
          await live.goto(href!)
          expect(await live.locator('h1').textContent()).toBe('Your website. Your rules.')
          await page.getByRole('button', { name: 'Close publishing' }).click()
          const heading = page
            .frameLocator('iframe[title="Site canvas"]')
            .locator('[data-freeflow-node="n-home-title"]')
          await heading.click()
          await page.getByLabel('Text', { exact: true }).fill('Ready for publishing')
          await page.getByRole('button', { name: 'Publish', exact: true }).click()
          await page.getByRole('button', { name: 'Publish v2', exact: true }).click()
          await page.getByText('Earlier releases (1)').click({ timeout: 20000 })
          await page.getByRole('button', { name: 'Restore v1', exact: true }).waitFor()
          await live.reload()
          expect(await live.locator('h1').textContent()).toBe('Ready for publishing')
          await page.getByRole('button', { name: 'Restore v1', exact: true }).click()
          await page.getByRole('button', { name: 'Confirm rollback' }).click()
          await expect
            .poll(() => page.locator('.publish-summary').textContent())
            .toContain('Live: v1')
          await live.reload()
          expect(await live.locator('h1').textContent()).toBe('Your website. Your rules.')
          await page.getByRole('button', { name: 'Close publishing' }).click()
          expect(await heading.textContent()).toBe('Ready for publishing')
        } finally {
          await browser.close()
        }
      } else {
        expect(
          (
            await post(
              `/api/sites/${id}/releases`,
              { expectedRevision: 1, expectedId: null },
              cookie,
            )
          ).status,
        ).toBe(202)
        await expect
          .poll(async () => (await history()).releases[0], { timeout: 20000 })
          .toMatchObject({ status: 'ready', error: null })
      }
      const publishedId = (await history()).publishedId
      expect(publishedId).toBeTruthy()
      await stop()
      await start()
      expect((await history()).publishedId).toBe(publishedId)
      // Node fetch overwrites Host; use HTTP directly to exercise wildcard-host routing.
      await new Promise<void>((resolve, reject) => {
        get(
          `http://127.0.0.1:${publicPort}/`,
          { headers: { host: `${id}.localhost:${publicPort}` } },
          (response) => {
            try {
              expect(response.statusCode).toBe(200)
              expect(response.headers['x-freeflow-release']).toBe(publishedId)
              response.resume()
              response.on('end', resolve)
            } catch (error) {
              response.resume()
              reject(error)
            }
          },
        ).on('error', reject)
      })
    } finally {
      await stop()
      await rm(dir, { recursive: true, force: true })
    }
  },
  60000,
)
