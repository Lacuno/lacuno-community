import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { HTTPException } from 'hono/http-exception'
import { signForCloud } from './gateway-auth.js'
import type { Target } from './publication-reader.js'

/** Cloud's export sink, which a gateway runtime reaches without internet access. */
export type ExportOptions = { url: string; secret: string; issuer: string }
type Pointer = { site_id: string; target: Target; release_id: string; attempts: number }

/** One call to the sink for a site's `key`, signed for exactly that site, key and body. */
async function send(
  options: ExportOptions,
  method: 'HEAD' | 'PUT',
  site: string,
  key: string,
  body?: Uint8Array,
) {
  const sha256 = body && createHash('sha256').update(body).digest('hex')
  const token = await signForCloud(options.secret, options.issuer, 'lacuno-export', {
    site,
    key,
    ...(sha256 ? { sha256 } : {}),
  })
  return fetch(`${options.url}/sites/${site}/${key}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/octet-stream' } : {}),
    },
    ...(body ? { body: new Uint8Array(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  })
}

/**
 * Keeps an asset's bytes in Cloud's object storage (`PUT <export>/sites/<site>/asset/<hash>`), so a
 * document never references an asset Cloud could not restore.
 */
export async function exportAsset(
  options: ExportOptions,
  site: string,
  hash: string,
  bytes: Uint8Array,
) {
  const response = await send(options, 'PUT', site, `asset/${hash}`, bytes).catch(() => undefined)
  if (response?.status !== 204) {
    console.error(`Export sink answered ${response?.status ?? 'nothing'} for an asset`)
    throw new HTTPException(502, { message: 'The file could not be stored. Please try again.' })
  }
}

/**
 * Copies published releases to Cloud's edge. Files go up before a release becomes ready; pointers
 * go through an outbox written with the publication, so a sink outage delays them, never loses them.
 */
export class Exporter {
  private stopped = false
  private draining = false
  private timer: ReturnType<typeof setInterval>

  constructor(
    private sqlite: Database.Database,
    private options: ExportOptions,
    private dist: (siteId: string, releaseId: string) => string,
  ) {
    // Backfill: publications from before the export, whose files the drain uploads first.
    sqlite
      .prepare(
        'INSERT OR IGNORE INTO export_pointer(site_id,target,release_id) SELECT site_id,target,release_id FROM publications WHERE release_id NOT IN (SELECT release_id FROM exported_release)',
      )
      .run()
    this.timer = setInterval(() => {
      void this.drain()
    }, 1000)
    this.timer.unref()
  }

  /** Call inside the transaction that points the target at the release. */
  queue(siteId: string, target: Target, releaseId: string) {
    this.sqlite
      .prepare(
        'INSERT INTO export_pointer(site_id,target,release_id) VALUES(?,?,?) ON CONFLICT(site_id,target) DO UPDATE SET release_id=excluded.release_id,attempts=0,next_attempt_at=0',
      )
      .run(siteId, target, releaseId)
  }

  async upload(siteId: string, releaseId: string) {
    const root = this.dist(siteId, releaseId)
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (this.stopped) throw new Error('Server stopped')
      const file = path.join(entry.parentPath, entry.name)
      const parts = path.relative(root, file).split(path.sep)
      // The publishing listener never serves hidden files or symbolic links either.
      if (!entry.isFile() || parts.some((part) => part.startsWith('.'))) continue
      // Content-addressed files are shared by every release of the site.
      const immutable = ['assets', '_astro'].includes(parts[0]!)
      const key = `${immutable ? 'immutable' : `releases/${releaseId}`}/${parts.map(encodeURIComponent).join('/')}`
      if (immutable && (await send(this.options, 'HEAD', siteId, key)).status === 200) continue
      const response = await send(this.options, 'PUT', siteId, key, await readFile(file))
      if (response.status !== 204) throw new Error(`Export sink answered ${response.status}`)
    }
    this.sqlite
      .prepare('INSERT OR IGNORE INTO exported_release(release_id) VALUES(?)')
      .run(releaseId)
  }

  private async drain() {
    if (this.stopped || this.draining) return
    this.draining = true
    try {
      const now = Date.now()
      const due = this.sqlite
        .prepare('SELECT * FROM export_pointer WHERE next_attempt_at <= ?')
        .all(now) as Pointer[]
      for (const row of due) {
        const where = [row.site_id, row.target, row.release_id] as const
        // Claim the row for a minute so a second API instance does not send it too.
        if (
          this.stopped ||
          !this.sqlite
            .prepare(
              'UPDATE export_pointer SET next_attempt_at=? WHERE site_id=? AND target=? AND release_id=? AND next_attempt_at <= ?',
            )
            .run(now + 60_000, ...where, now).changes
        )
          continue
        let sent = false
        try {
          // A rollback or backfill can point at a release built before the export existed.
          if (
            !this.sqlite
              .prepare('SELECT 1 FROM exported_release WHERE release_id=?')
              .get(row.release_id)
          )
            await this.upload(row.site_id, row.release_id)
          const response = await send(
            this.options,
            'PUT',
            row.site_id,
            `pointer/${row.target}`,
            Buffer.from(row.release_id),
          )
          if (response.status !== 204) throw new Error(`Export sink answered ${response.status}`)
          sent = true
        } catch (error) {
          if (!this.stopped) console.error('Export of a publication failed; retrying', error)
        }
        if (this.stopped) return
        if (sent)
          this.sqlite
            .prepare('DELETE FROM export_pointer WHERE site_id=? AND target=? AND release_id=?')
            .run(...where)
        else
          this.sqlite
            .prepare(
              'UPDATE export_pointer SET attempts=attempts+1,next_attempt_at=? WHERE site_id=? AND target=? AND release_id=?',
            )
            .run(Date.now() + Math.min(1000 * 2 ** row.attempts, 300_000), ...where)
      }
    } finally {
      this.draining = false
    }
  }

  close() {
    this.stopped = true
    clearInterval(this.timer)
  }
}
