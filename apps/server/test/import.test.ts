import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { SignJWT } from 'jose'
import { expect, it } from 'vitest'
import yazl from 'yazl'
import { createServer } from '../src/app.js'
import { importExport } from '../src/backup.js'
import { openDatabase } from '../src/database.js'
import { root } from './harness.js'

const issuer = 'http://cloud.localhost:4000'
const origin = 'http://runtime.editor.localhost:4000'
const secret = 'import-test-gateway-key-of-32-characters'
const settings = (dataDir: string, baseURL: string) => ({
  dataDir,
  baseURL,
  secret: 'import-test-auth-secret-at-least-32-chars',
  templateDir: path.join(root, 'templates/lacuno'),
})

/** A request to a managed runtime as Cloud's gateway signs it. */
async function managed(
  server: Awaited<ReturnType<typeof createServer>>,
  target: string,
  data?: unknown,
) {
  const method = data === undefined ? 'GET' : 'POST'
  const body = data === undefined ? '' : JSON.stringify(data)
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({
    sub: 'cloud-user-1',
    name: 'Cloud owner',
    email: 'owner@example.test',
    jti: randomUUID(),
    iat: now,
    exp: now + 30,
    method,
    target,
    bodyHash: createHash('sha256').update(body).digest('hex'),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience(origin)
    .sign(new TextEncoder().encode(secret))
  const response = await server.app.request(origin + target, {
    method,
    headers: { origin, 'content-type': 'application/json', 'x-lacuno-assertion': assertion },
    ...(body ? { body } : {}),
  })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return response.json()
}

/** Every file under `directory`, relative to it. */
async function tree(directory: string) {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
}

/** A backup as Cloud writes it: the database, the files beside it and their checksums. */
async function backup(live: string, directory: string) {
  const { sqlite } = openDatabase(live)
  await sqlite.backup(path.join(directory, 'lacuno.sqlite'))
  sqlite.close()
  const files = []
  for (const name of (await tree(live)).filter((name) => name.startsWith('builds/'))) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await writeFile(path.join(directory, name), await readFile(path.join(live, name)))
  }
  for (const name of (await tree(directory)).sort()) {
    const bytes = await readFile(path.join(directory, name))
    files.push({
      name,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), files }
  await writeFile(path.join(directory, 'backup.json'), JSON.stringify(manifest))
}

/** A zip as Cloud writes it: the backup under `backup/`, a README beside it, and `extra`. */
async function zip(file: string, backup: string, extra: Record<string, string> = {}) {
  const archive = new yazl.ZipFile()
  archive.addBuffer(Buffer.from('How to import'), 'README.txt')
  for (const name of await tree(backup))
    archive.addBuffer(await readFile(path.join(backup, name)), `backup/${name}`)
  for (const [name, text] of Object.entries(extra)) archive.addBuffer(Buffer.from(text), name)
  archive.end()
  await pipeline(archive.outputStream, createWriteStream(file))
}

it('imports a Lacuno Cloud export into a self-hosted instance whose owner takes over its sites', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'lacuno-import-test-'))
  const live = path.join(work, 'live')
  try {
    // A managed workspace with two sites and a release whose build Cloud no longer keeps.
    const cloud = await createServer({ ...settings(live, origin), gateway: { issuer, secret } })
    try {
      await managed(cloud, '/api/sites', { name: 'Studio' })
      await managed(cloud, '/api/sites', { name: 'Shop' })
    } finally {
      cloud.close()
    }
    // Three releases: live with its files, one Cloud kept no files of, and an unfinished one.
    const { sqlite: runtime } = openDatabase(live)
    const [kept, gone, unfinished] = [randomUUID(), randomUUID(), randomUUID()]
    const release = runtime.prepare(
      'INSERT INTO releases(id,site_id,revision,document,status,created_at,version) SELECT ?,id,revision,document,?,?,? FROM sites ORDER BY name LIMIT 1',
    )
    release.run(kept, 'ready', Date.now(), 1)
    release.run(gone, 'ready', Date.now(), 2)
    release.run(unfinished, 'building', Date.now(), 3)
    const site = runtime.prepare('SELECT site_id FROM releases WHERE id=?').pluck().get(kept)
    runtime.close()
    const dist = path.join(live, 'builds', String(site), kept, 'dist')
    await mkdir(dist, { recursive: true })
    await writeFile(path.join(dist, 'index.html'), '<h1>Live</h1>')
    const copy = path.join(work, 'backup')
    await mkdir(copy)
    await backup(live, copy)
    const file = path.join(work, 'export.zip')
    await zip(file, copy, { 'elsewhere/ignored.txt': 'not part of the backup' })

    const data = path.join(work, 'data')
    expect(await importExport(file, data)).toBe(2)
    expect((await tree(data)).some((name) => name.startsWith('elsewhere'))).toBe(false)
    const { sqlite } = openDatabase(data)
    try {
      expect(sqlite.prepare('SELECT count(*) FROM gateway_mode').pluck().get()).toBe(0)
      expect(sqlite.prepare('SELECT count(*) FROM user').pluck().get()).toBe(0)
      const status = sqlite.prepare('SELECT status FROM releases WHERE id=?').pluck()
      expect([kept, gone, unfinished].map((id) => status.get(id))).toEqual([
        'ready',
        'failed',
        'failed',
      ])
      expect(
        await readFile(path.join(data, 'builds', String(site), kept, 'dist/index.html'), 'utf8'),
      ).toBe('<h1>Live</h1>')
    } finally {
      sqlite.close()
    }

    // First run: the owner set up with the token gets the imported sites.
    const local = 'http://localhost:3000'
    const server = await createServer(settings(data, local))
    try {
      const { sqlite } = openDatabase(data)
      const token = sqlite.prepare('SELECT token FROM owner_setup').pluck().get()
      sqlite.close()
      const headers = { origin: local, 'content-type': 'application/json' }
      const setup = await server.app.request(`${local}/api/setup`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Owner',
          email: 'owner@example.test',
          password: 'a-private-owner-password',
          token,
        }),
      })
      expect(setup.status).toBe(200)
      const cookie = setup.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ')
      const { sites } = await (
        await server.app.request(`${local}/api/sites`, { headers: { ...headers, cookie } })
      ).json()
      expect(sites.map((site: { name: string }) => site.name).sort()).toEqual(['Shop', 'Studio'])
    } finally {
      server.close()
    }

    // Only into an empty directory, and only an intact backup.
    await expect(importExport(file, data)).rejects.toThrow('empty')
    await writeFile(path.join(copy, 'lacuno.sqlite'), 'changed')
    await zip(file, copy)
    await expect(importExport(file, path.join(work, 'tampered'))).rejects.toThrow('checksum')
    await mkdir(path.join(work, 'none'))
    await expect(
      importExport(path.join(work, 'missing.zip'), path.join(work, 'none')),
    ).rejects.toThrow()
  } finally {
    await rm(work, { recursive: true, force: true })
  }
})
