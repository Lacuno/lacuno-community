import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { backupWorkspace, restoreWorkspace, verifyBackup } from '../src/backup.js'

it('backs up pending releases without mutating live state and rejects incomplete or unsafe restores', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lacuno-backup-test-'))
  const dataDir = path.join(root, 'live')
  const server = await createServer({
    dataDir,
    baseURL: 'http://localhost:3000',
    secret: 'backup-test-secret-at-least-32-characters',
    allowSignup: true,
    templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
  })
  try {
    const account = await server.app.request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner',
        email: 'backup@example.test',
        password: 'backup-test-password',
      }),
    })
    const cookie = account.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const created = await server.app.request('http://localhost:3000/api/sites', {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Backup fixture' }),
    })
    expect(created.status).toBe(201)
    const sqlite = new Database(path.join(dataDir, 'lacuno.sqlite'))
    try {
      const releaseId = randomUUID()
      sqlite
        .prepare(
          "INSERT INTO releases(id,site_id,revision,document,status,created_at,version) SELECT ?,id,revision,document,'queued',?,1 FROM sites",
        )
        .run(releaseId, Date.now())
      // Both pointers travel with the SQLite snapshot.
      sqlite
        .prepare(
          "INSERT INTO publications(site_id,target,release_id) SELECT id,'production',? FROM sites UNION ALL SELECT id,'testing',? FROM sites",
        )
        .run(releaseId, releaseId)
      const backup = path.join(root, 'backup')
      await backupWorkspace(dataDir, backup)
      expect(
        (sqlite.prepare('SELECT status FROM releases').get() as { status: string }).status,
      ).toBe('queued')
      const snapshot = new Database(path.join(backup, 'lacuno.sqlite'), { readonly: true })
      expect(
        (snapshot.prepare('SELECT status FROM releases').get() as { status: string }).status,
      ).toBe('failed')
      snapshot.close()
      await restoreWorkspace(backup, path.join(root, 'restored'))
      const restored = new Database(path.join(root, 'restored', 'lacuno.sqlite'), {
        readonly: true,
      })
      expect(
        restored.prepare('SELECT target FROM publications ORDER BY target').pluck().all(),
      ).toEqual(['production', 'testing'])
      restored.close()
      await expect(backupWorkspace(dataDir, path.join(dataDir, 'unsafe'))).rejects.toThrow(
        'outside',
      )
      await expect(restoreWorkspace(backup, dataDir)).rejects.toThrow('empty')
      await symlink(path.join(backup, 'lacuno.sqlite'), path.join(backup, 'link'))
      await expect(verifyBackup(backup)).rejects.toThrow('symlinks')
      await rm(path.join(backup, 'link'))
      const database = await readFile(path.join(backup, 'lacuno.sqlite'))
      await writeFile(path.join(backup, 'lacuno.sqlite'), 'corrupted')
      await expect(verifyBackup(backup)).rejects.toThrow('checksum')
      await writeFile(path.join(backup, 'lacuno.sqlite'), database)
      await verifyBackup(backup)
      const original = await readFile(path.join(backup, 'backup.json'), 'utf8')
      const manifest = JSON.parse(original)
      manifest.files.push(manifest.files[0])
      await writeFile(path.join(backup, 'backup.json'), JSON.stringify(manifest))
      await expect(restoreWorkspace(backup, path.join(root, 'invalid'))).rejects.toThrow(
        'inventory',
      )
      await rm(path.join(backup, 'backup.json'))
      await expect(verifyBackup(backup)).rejects.toThrow()
    } finally {
      sqlite.close()
    }
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})
