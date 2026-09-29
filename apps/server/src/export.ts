import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
  method: 'HEAD' | 'PUT' | 'DELETE',
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

/** About a minute of waits between attempts, long enough for Cloud to redeploy its sink. */
const retryDelays = [1, 2, 4, 8, 15, 15, 15].map((seconds) => seconds * 1000)

/**
 * Makes a call again after no answer, a 429 or a 5xx, waiting `delays` between attempts; the last
 * answer, or undefined when there was none.
 */
export async function withRetries(
  call: () => Promise<Response>,
  delays = retryDelays,
  stopped = () => false,
) {
  for (let attempt = 0; ; attempt++) {
    const response = await call().catch(() => undefined)
    const transient = !response || response.status === 429 || response.status >= 500
    if (!transient || attempt === delays.length || stopped()) return response
    await response?.body?.cancel()
    await delay(delays[attempt], undefined, { ref: false })
  }
}

/**
 * Waits for one of Cloud's build slots (`PUT <export>/sites/<site>/build`: 204 held, 202 waiting in
 * line), so the server runs only so many builds at once; `waiting` is called while it waits. A
 * runtime holds at most one, leased: it is renewed every 10 s while held, and this resolves to a
 * function that gives it back (`DELETE`). A Cloud without build slots refuses the key, and the
 * build starts at once; a sink that does not answer is asked again, like a full line, for up to
 * ten minutes.
 */
export async function buildSlot(
  options: ExportOptions,
  site: string,
  waiting: () => void,
  stopped: () => boolean,
) {
  const key = 'build'
  const ask = async () => {
    const response = await send(options, 'PUT', site, key, Buffer.alloc(0)).catch(() => undefined)
    await response?.body?.cancel()
    return response?.status
  }
  for (const deadline = Date.now() + 600_000; ; ) {
    const status = await ask()
    if (status === 204) break
    if (status && status !== 202 && status !== 429 && status < 500) return () => {}
    if (stopped()) throw new Error('Server stopped')
    if (Date.now() > deadline)
      throw new Error('Too many sites are being published right now. Publish again in a minute.')
    waiting()
    await delay(1000, undefined, { ref: false })
  }
  const renew = setInterval(() => void ask(), 10_000)
  renew.unref()
  return () => {
    clearInterval(renew)
    void send(options, 'DELETE', site, key)
      .then((response) => response.body?.cancel())
      .catch(() => {})
  }
}

/** Uploads at the same time; the sink passes each one on to Bunny Storage. */
const parallelUploads = 8

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
  // The workspace is at its plan's storage limit.
  if (response?.status === 507)
    throw new HTTPException(507, {
      message:
        'Storage is full. This workspace has used all the storage in its plan. Delete files you no longer need or upgrade the plan.',
    })
  if (response?.status !== 204) {
    console.error(`Export sink answered ${response?.status ?? 'nothing'} for an asset`)
    throw new HTTPException(502, { message: 'The file could not be stored. Please try again.' })
  }
}

/** Sends a site's thumbnail to Cloud (`PUT <export>/sites/<site>/thumbnail`) for its dashboard. */
export async function exportThumbnail(options: ExportOptions, site: string, image: Uint8Array) {
  const response = await send(options, 'PUT', site, 'thumbnail', image).catch(() => undefined)
  if (response?.status !== 204) {
    console.error(`Export sink answered ${response?.status ?? 'nothing'} for a thumbnail`)
    throw new HTTPException(502, { message: 'The thumbnail could not be stored.' })
  }
}

/**
 * Tells Cloud what an AI app did, for the person who connected it
 * (`PUT <export>/sites/<site>/activity`). Best effort: the app's work never waits on it.
 */
export async function exportActivity(
  options: ExportOptions,
  site: string,
  activity: { user: string; app: string; action: string },
) {
  const body = Buffer.from(JSON.stringify(activity))
  const response = await send(options, 'PUT', site, 'activity', body).catch(() => undefined)
  if (response?.status !== 204)
    console.error(`Export sink answered ${response?.status ?? 'nothing'} for activity`)
}

/**
 * The hashes of the assets a document lists, sorted, one per line: the body of
 * `PUT <export>/sites/<site>/assets`, which tells Cloud the files the site uses now.
 */
export function assetList(document: { assets?: Record<string, { hash: string }> }) {
  return [...new Set(Object.values(document.assets ?? {}).map(({ hash }) => hash))]
    .sort()
    .join('\n')
}

/**
 * Copies published releases to Cloud's edge. Files go up before a release becomes ready; pointers
 * go through an outbox written with the publication, so a sink outage delays them, never loses them.
 * A site's asset list goes through an outbox too, written when a save changes it.
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
    queueMicrotask(() => {
      void this.drain()
    })
  }

  /**
   * Uploads a release's files, `parallelUploads` at a time, each retried through a sink outage.
   * Content-addressed files the sink has already are skipped.
   */
  async upload(siteId: string, releaseId: string) {
    const root = this.dist(siteId, releaseId)
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .map((entry) => ({
        entry,
        parts: path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep),
      }))
      // The publishing listener never serves hidden files or symbolic links either.
      .filter(({ entry, parts }) => entry.isFile() && !parts.some((part) => part.startsWith('.')))
    const sent = { files: 0, bytes: 0, skipped: 0 }
    let next = 0
    let failed = false
    const stopped = () => this.stopped || failed
    const upload = async () => {
      while (next < files.length && !stopped()) {
        const { entry, parts } = files[next++]!
        // Content-addressed files are shared by every release of the site.
        const immutable = ['assets', '_astro'].includes(parts[0]!)
        const key = `${immutable ? 'immutable' : `releases/${releaseId}`}/${parts.map(encodeURIComponent).join('/')}`
        if (immutable) {
          const head = await withRetries(
            () => send(this.options, 'HEAD', siteId, key),
            undefined,
            stopped,
          )
          if (head?.status === 200) {
            sent.skipped++
            continue
          }
        }
        const body = await readFile(path.join(entry.parentPath, entry.name))
        const response = await withRetries(
          () => send(this.options, 'PUT', siteId, key, body),
          undefined,
          stopped,
        )
        if (response?.status !== 204) {
          failed = true
          throw new Error(`Export sink answered ${response?.status ?? 'nothing'} for ${key}`)
        }
        sent.files++
        sent.bytes += body.length
      }
    }
    await Promise.all(Array.from({ length: parallelUploads }, upload))
    if (this.stopped) throw new Error('Server stopped')
    this.sqlite
      .prepare('INSERT OR IGNORE INTO exported_release(release_id) VALUES(?)')
      .run(releaseId)
    return sent
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
      const lists = this.sqlite
        .prepare('SELECT site_id,attempts FROM export_assets WHERE next_attempt_at <= ?')
        .all(now) as { site_id: string; attempts: number }[]
      for (const { site_id, attempts } of lists) {
        // Claimed like a pointer; a save while it is sent sets it due again, so it stays queued.
        const claim = now + 60_000
        if (
          this.stopped ||
          !this.sqlite
            .prepare(
              'UPDATE export_assets SET next_attempt_at=? WHERE site_id=? AND next_attempt_at <= ?',
            )
            .run(claim, site_id, now).changes
        )
          continue
        const { document } = this.sqlite
          .prepare('SELECT document FROM sites WHERE id=?')
          .get(site_id) as { document: string }
        const body = Buffer.from(assetList(JSON.parse(document)))
        const response = await send(this.options, 'PUT', site_id, 'assets', body).catch(
          () => undefined,
        )
        if (this.stopped) return
        if (response?.status === 204)
          this.sqlite
            .prepare('DELETE FROM export_assets WHERE site_id=? AND next_attempt_at=?')
            .run(site_id, claim)
        else {
          console.error(`Export sink answered ${response?.status ?? 'nothing'} for an asset list`)
          this.sqlite
            .prepare(
              'UPDATE export_assets SET attempts=attempts+1,next_attempt_at=? WHERE site_id=? AND next_attempt_at=?',
            )
            .run(Date.now() + Math.min(1000 * 2 ** attempts, 300_000), site_id, claim)
        }
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
