import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import { launch, root } from './harness.js'

const exec = promisify(execFile)
const settings = (dataDir: string, baseURL: string) => ({
  dataDir,
  baseURL,
  templateDir: path.join(root, 'templates/freeflow'),
  editorDir: path.join(root, 'apps/editor/dist'),
  secret: 'owner-setup-test-secret-82934698234698234',
})
const account = { name: 'Owner', email: 'owner@example.test', password: 'a-private-owner-password' }

async function token(dir: string) {
  return (
    await exec(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'apps/server/src/setup-token.ts')],
      {
        env: { ...process.env, FREEFLOW_DATA_DIR: dir },
      },
    )
  ).stdout.trim()
}

it('protects first-owner setup, serializes claims across instances, and never reopens registration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-owner-'))
  const origin = 'http://localhost:3000'
  let server = await createServer(settings(dir, origin))
  const peer = await createServer({ ...settings(dir, origin), allowSignup: true })
  const request = (
    app = server.app,
    route = '/api/setup',
    body: unknown = account,
    requestOrigin = origin,
  ) =>
    app.request(origin + route, {
      method: 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  try {
    const setupToken = await token(dir)
    expect(setupToken).toMatch(/^[a-f0-9]{64}$/)
    const config = await (await server.app.request(`${origin}/api/config`)).json()
    expect(config).toEqual({ allowSignup: false, setupRequired: true, origin, local: true })
    expect(JSON.stringify(config)).not.toContain(setupToken)
    expect((await request(server.app, '/api/setup', { ...account, token: 'wrong' })).status).toBe(
      403,
    )
    expect(
      (
        await request(
          server.app,
          '/api/setup',
          { ...account, token: setupToken },
          'https://untrusted.test',
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await request(server.app, '/api/setup', {
          ...account,
          token: setupToken,
          password: 'short',
        })
      ).status,
    ).toBe(400)
    server.close()
    server = await createServer(settings(dir, origin))
    expect(await token(dir)).toBe(setupToken)
    const results = await Promise.all([
      request(server.app, '/api/setup', { ...account, token: setupToken }),
      request(peer.app, '/api/setup', {
        ...account,
        email: 'other@example.test',
        token: setupToken,
      }),
    ])
    expect(results.filter((response) => response.ok)).toHaveLength(1)
    // The loser may observe the committed owner or an overlapping SQLite transaction.
    expect([409, 503]).toContain(results.find((response) => !response.ok)!.status)
    const success = results.find((response) => response.ok)!
    const cookie = success.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    expect((await server.app.request(`${origin}/api/sites`, { headers: { cookie } })).status).toBe(
      200,
    )
    expect(
      (await request(server.app, '/api/setup', { ...account, token: setupToken })).status,
    ).toBe(409)
    const { sqlite } = openDatabase(dir)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 1 })
    expect(sqlite.prepare('SELECT token FROM owner_setup').get()).toEqual({ token: null })
    sqlite.close()
    server.close()
    server = await createServer({ ...settings(dir, origin), allowSignup: true })
    expect(await (await server.app.request(`${origin}/api/config`)).json()).toEqual({
      allowSignup: false,
      setupRequired: false,
      origin,
      local: true,
    })
    expect(
      (
        await request(server.app, '/api/auth/sign-up/email', {
          ...account,
          email: 'third@example.test',
        })
      ).status,
    ).toBe(400)
    await expect(token(dir)).rejects.toThrow('No owner setup is pending')
  } finally {
    peer.close()
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('creates the owner through the browser and returns to sign-in after setup', async () => {
  const { dir, page, origin } = await launch({ width: 1300, height: 900 }, false)
  await page.goto(origin)
  await page.getByLabel('Your name').fill(account.name)
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByLabel('Setup token', { exact: true }).fill('wrong')
  await page.getByRole('button', { name: 'Create owner account' }).click()
  await expect.poll(() => page.getByRole('alert').textContent()).toBe('Invalid setup token.')
  await page.getByLabel('Setup token', { exact: true }).fill(await token(dir))
  await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/owner-setup.png') })
  await page.getByRole('button', { name: 'Create owner account' }).click()
  await page.getByLabel('Site name').waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
  expect(await page.getByLabel('Setup token', { exact: true }).count()).toBe(0)
  expect(await page.getByRole('button', { name: 'New here? Create an account' }).count()).toBe(0)
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Site name').waitFor()
})
