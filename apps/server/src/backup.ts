import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from '@freeflow/schema'
import Database from 'better-sqlite3'
import { z } from 'zod'

const Manifest = z.strictObject({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  files: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int().nonnegative(),
      }),
    )
    .min(1),
})

async function digest(file: string) {
  const hash = createHash('sha256')
  let size = 0
  for await (const bytes of createReadStream(file)) {
    hash.update(bytes)
    size += bytes.length
  }
  return { sha256: hash.digest('hex'), size }
}

async function files(root: string, directory = ''): Promise<string[]> {
  const result: string[] = []
  for (const name of await readdir(path.join(root, directory))) {
    const relative = path.join(directory, name)
    const info = await lstat(path.join(root, relative))
    if (info.isDirectory()) result.push(...(await files(root, relative)))
    else if (info.isFile()) result.push(relative)
    else throw new Error('Backups cannot contain symlinks or special files')
  }
  return result.sort()
}

async function emptyDestination(destination: string) {
  await mkdir(destination, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
  const info = await lstat(destination)
  if (!info.isDirectory() || (await readdir(destination)).length)
    throw new Error('Destination must be an empty directory, not a symlink')
}

async function outsideDestination(source: string, destination: string) {
  const resolved = path.resolve(destination)
  const canonical = path.join(await realpath(path.dirname(resolved)), path.basename(resolved))
  if (canonical === source || canonical.startsWith(source + path.sep))
    throw new Error('Destination must be outside the source data directory')
  return canonical
}

/** Copies one file whose name came from `files()`, so it is already known to be a regular file. */
async function copy(root: string, destination: string, name: string) {
  const target = path.join(destination, name)
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await copyFile(path.join(root, name), target, constants.COPYFILE_EXCL)
}

/** Runs the copy phase into a verified-empty destination and removes it again if anything fails. */
async function fill<T>(destination: string, work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

/** SQLite snapshot first; referenced assets and ready releases are immutable and never pruned. */
export async function backupWorkspace(source: string, destination: string) {
  source = await realpath(source)
  destination = await outsideDestination(source, destination)
  await emptyDestination(destination)
  destination = await realpath(destination)
  return fill(destination, async () => {
    const live = new Database(path.join(source, 'freeflow.sqlite'), {
      readonly: true,
      fileMustExist: true,
    })
    try {
      await live.backup(path.join(destination, 'freeflow.sqlite'))
    } finally {
      live.close()
    }
    const files = await snapshotFiles(source, destination)
    const manifest = { version: 1, createdAt: new Date().toISOString(), files }
    // Completion marker is written last; a failed or interrupted copy is not a backup.
    await writeFile(path.join(destination, 'backup.json'), JSON.stringify(manifest), {
      flag: 'wx',
      mode: 0o600,
    })
    return manifest
  })
}

/** Marks unfinished builds failed in the snapshot, copies what it references and returns the inventory. */
async function snapshotFiles(source: string, destination: string) {
  const snapshot = new Database(path.join(destination, 'freeflow.sqlite'))
  const required = new Set<string>()
  try {
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('SQLite integrity check failed')
    const documents = snapshot
      .prepare(
        'SELECT id AS site_id,document FROM sites UNION ALL SELECT site_id,document FROM releases',
      )
      .all() as { site_id: string; document: string }[]
    for (const row of documents) {
      z.uuid().parse(row.site_id)
      const doc = parseDocument(JSON.parse(row.document))
      for (const asset of Object.values(doc.assets)) {
        if (!/^[a-f0-9]{64}$/.test(asset.hash)) throw new Error('Invalid asset hash')
        required.add(`sites/${row.site_id}/assets/${asset.hash}`)
      }
    }
    const ready = snapshot
      .prepare("SELECT id,site_id FROM releases WHERE status='ready'")
      .all() as { id: string; site_id: string }[]
    for (const row of ready) {
      z.uuid().parse(row.id)
      z.uuid().parse(row.site_id)
      const directory = `builds/${row.site_id}/${row.id}/dist`
      for (const name of await files(source, directory)) required.add(name)
    }
    // Interrupted jobs must never resume against a partially copied build directory.
    snapshot
      .prepare(
        "UPDATE releases SET status='failed',error='Not completed at backup time. Publish again to retry.',finished_at=?,owner=NULL,lease_until=NULL WHERE status IN ('queued','building')",
      )
      .run(Date.now())
    snapshot.pragma('journal_mode = DELETE')
  } finally {
    snapshot.close()
  }
  for (const name of required) {
    await copy(source, destination, name)
    if (
      name.startsWith('sites/') &&
      (await digest(path.join(destination, name))).sha256 !== path.basename(name)
    )
      throw new Error('Asset checksum mismatch')
  }
  const entries = []
  for (const name of await files(destination))
    entries.push({ name, ...(await digest(path.join(destination, name))) })
  return entries
}

export async function verifyBackup(source: string) {
  source = await realpath(source)
  const inventory = await files(source)
  const manifest = Manifest.parse(
    JSON.parse(await readFile(path.join(source, 'backup.json'), 'utf8')),
  )
  const names = manifest.files.map((file) => file.name)
  if (
    new Set(names).size !== names.length ||
    !names.includes('freeflow.sqlite') ||
    JSON.stringify([...names, 'backup.json'].sort()) !== JSON.stringify(inventory)
  )
    throw new Error('Backup file inventory mismatch')
  // Every manifest name matched the on-disk inventory above, so no name can escape the backup.
  for (const file of manifest.files) {
    const actual = await digest(path.join(source, file.name))
    if (actual.sha256 !== file.sha256 || actual.size !== file.size)
      throw new Error('Backup checksum mismatch')
  }
  const sqlite = new Database(path.join(source, 'freeflow.sqlite'), {
    readonly: true,
    fileMustExist: true,
  })
  try {
    if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('SQLite integrity check failed')
  } finally {
    sqlite.close()
  }
  return manifest
}

/** Restore only to an empty location. Never overwrite the live workspace. */
export async function restoreWorkspace(source: string, destination: string) {
  source = await realpath(source)
  destination = await outsideDestination(source, destination)
  const manifest = await verifyBackup(source)
  await emptyDestination(destination)
  destination = await realpath(destination)
  await fill(destination, async () => {
    for (const file of manifest.files) await copy(source, destination, file.name)
  })
}
