import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashAsset, parseDocument } from '@freeflow/schema'
import type Database from 'better-sqlite3'
import { HTTPException } from 'hono/http-exception'

type ReleaseRow = {
  id: string
  site_id: string
  revision: number
  version: number
  document: string
  status: 'queued' | 'building' | 'ready' | 'failed'
  created_at: number
  finished_at: number | null
  error: string | null
  warnings: string
  owner: string | null
  lease_until: number | null
}
const conflict = (message: string) => new HTTPException(409, { message })
const leaseMs = 30_000

/** Durable release queue. SQLite claims serialize each site even with multiple API instances. */
export class Releases {
  private owner = randomUUID()
  private stopped = false
  private running = false
  private timer: ReturnType<typeof setInterval>
  private child: ChildProcess | undefined
  readonly dataDir: string
  private base: URL

  constructor(
    private sqlite: Database.Database,
    dataDir: string,
    baseURL: string,
  ) {
    this.dataDir = path.resolve(dataDir)
    this.base = new URL(baseURL)
    if (
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.pathname !== '/' ||
      this.base.search ||
      this.base.hash
    )
      throw new Error('Published base URL must be an HTTP(S) origin without a path or credentials')
    if (this.base.hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(this.base.hostname))
      throw new Error('Published base URL needs a hostname, such as localhost or sites.example.net')
    this.timer = setInterval(() => {
      void this.tick()
    }, 1000)
    this.timer.unref()
    queueMicrotask(() => {
      void this.tick()
    })
  }

  url(siteId: string) {
    const url = new URL(this.base)
    url.hostname = `${siteId}.${url.hostname}`
    return url.origin
  }

  siteForHost(hostname: string) {
    const suffix = `.${this.base.hostname}`
    if (!hostname.endsWith(suffix)) return
    const id = hostname.slice(0, -suffix.length)
    return /^[0-9a-f-]{36}$/.test(id) ? id : undefined
  }

  directory(siteId: string, releaseId: string) {
    return path.join(this.dataDir, 'builds', siteId, releaseId)
  }

  current(siteId: string): string | null {
    return (
      (
        this.sqlite.prepare('SELECT release_id FROM publications WHERE site_id = ?').get(siteId) as
          | { release_id: string }
          | undefined
      )?.release_id ?? null
    )
  }

  list(siteId: string) {
    const rows = this.sqlite
      .prepare(
        'SELECT id,revision,version,status,created_at,finished_at,error,warnings FROM releases WHERE site_id = ? ORDER BY version DESC',
      )
      .all(siteId) as Omit<ReleaseRow, 'document' | 'site_id' | 'owner' | 'lease_until'>[]
    return {
      enabled: true,
      publishedId: this.current(siteId),
      url: this.url(siteId),
      releases: rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        version: row.version,
        status: row.status,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        error: row.error,
        warnings: JSON.parse(row.warnings) as { node?: string; message: string }[],
      })),
    }
  }

  readyIds(siteId: string) {
    return (
      this.sqlite
        .prepare(
          "SELECT id FROM releases WHERE site_id = ? AND status = 'ready' ORDER BY created_at DESC, rowid DESC",
        )
        .all(siteId) as { id: string }[]
    ).map((row) => row.id)
  }

  publish(siteId: string, revision: number, publishedId: string | null) {
    const id = randomUUID()
    this.sqlite
      .transaction(() => {
        this.checkPublication(siteId, publishedId)
        const site = this.sqlite
          .prepare('SELECT document, revision FROM sites WHERE id = ?')
          .get(siteId) as { document: string; revision: number }
        if (site.revision !== revision)
          throw conflict('The draft changed. Reload before publishing.')
        const { version } = this.sqlite
          .prepare(
            'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM releases WHERE site_id = ?',
          )
          .get(siteId) as { version: number }
        this.sqlite
          .prepare(
            "INSERT INTO releases(id,site_id,revision,version,document,status,created_at) VALUES(?,?,?,?,?,'queued',?)",
          )
          .run(id, siteId, revision, version, site.document, Date.now())
      })
      .immediate()
    void this.tick()
    return { id }
  }

  private checkPublication(siteId: string, expected: string | null) {
    if (this.current(siteId) !== expected)
      throw conflict('The published release changed. Refresh release history and try again.')
    if (
      this.sqlite
        .prepare("SELECT id FROM releases WHERE site_id = ? AND status IN ('queued','building')")
        .get(siteId)
    )
      throw conflict('A publish is already queued or building for this site.')
  }

  rollback(siteId: string, id: string, expected: string | null) {
    this.sqlite
      .transaction(() => {
        this.checkPublication(siteId, expected)
        const release = this.sqlite
          .prepare("SELECT id FROM releases WHERE id = ? AND site_id = ? AND status = 'ready'")
          .get(id, siteId)
        if (!release) throw new HTTPException(404, { message: 'Successful release not found' })
        this.activate(siteId, id)
      })
      .immediate()
  }

  private activate(siteId: string, id: string) {
    this.sqlite
      .prepare(
        'INSERT INTO publications(site_id,release_id) VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET release_id=excluded.release_id',
      )
      .run(siteId, id)
  }

  private async tick() {
    if (this.stopped || this.running) return
    this.running = true
    let job: ReleaseRow | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      job = this.sqlite
        .transaction(() => {
          this.sqlite
            .prepare(
              "UPDATE releases SET status='failed',error='Build interrupted. Publish again to retry.',finished_at=?,owner=NULL,lease_until=NULL WHERE status='building' AND lease_until < ?",
            )
            .run(Date.now(), Date.now())
          const row = this.sqlite
            .prepare(
              "SELECT * FROM releases WHERE status='queued' ORDER BY created_at, rowid LIMIT 1",
            )
            .get() as ReleaseRow | undefined
          if (row)
            this.sqlite
              .prepare("UPDATE releases SET status='building',owner=?,lease_until=? WHERE id=?")
              .run(this.owner, Date.now() + leaseMs, row.id)
          return row
        })
        .immediate()
      if (!job) return
      const id = job.id
      heartbeat = setInterval(() => {
        if (!this.stopped)
          this.sqlite
            .prepare(
              "UPDATE releases SET lease_until=? WHERE id=? AND owner=? AND status='building'",
            )
            .run(Date.now() + leaseMs, id, this.owner)
      }, 5000)
      heartbeat.unref()
      const warnings = await this.build(job)
      if (this.stopped) return
      this.sqlite
        .transaction(() => {
          const result = this.sqlite
            .prepare(
              "UPDATE releases SET status='ready',finished_at=?,warnings=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=? AND status='building'",
            )
            .run(Date.now(), JSON.stringify(warnings), id, this.owner)
          if (result.changes) this.activate(job!.site_id, id)
        })
        .immediate()
    } catch (error) {
      if (!this.stopped && job)
        this.sqlite
          .prepare(
            "UPDATE releases SET status='failed',finished_at=?,error=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=? AND status='building'",
          )
          .run(
            Date.now(),
            (error instanceof Error ? error.message : 'Build failed').slice(0, 4000),
            job.id,
            this.owner,
          )
      else if (!this.stopped) console.error('Release queue failed', error)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      this.running = false
    }
  }

  private async build(job: ReleaseRow): Promise<unknown[]> {
    const doc = parseDocument(JSON.parse(job.document))
    const directory = this.directory(job.site_id, job.id)
    await mkdir(path.join(directory, 'assets'), { recursive: true })
    await writeFile(path.join(directory, 'freeflow.json'), JSON.stringify(doc))
    for (const asset of Object.values(doc.assets)) {
      if (this.stopped) throw new Error('Server stopped')
      const bytes = await readFile(
        path.join(this.dataDir, 'sites', job.site_id, 'assets', asset.hash),
      )
      if ((await hashAsset(bytes)) !== asset.hash)
        throw new Error(`Asset checksum mismatch: ${asset.name}`)
      await writeFile(path.join(directory, 'assets', asset.hash), bytes)
    }
    if (this.stopped) throw new Error('Server stopped')
    const source = import.meta.url.endsWith('.ts')
    const worker = fileURLToPath(
      new URL(source ? './build-worker.ts' : './build-worker.js', import.meta.url),
    )
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          ...(source ? ['--import', import.meta.resolve('tsx')] : []),
          worker,
          directory,
          this.url(job.site_id),
        ],
        { stdio: 'ignore' },
      )
      this.child = child
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('Build exceeded the five-minute limit'))
      }, 300_000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        this.child = undefined
        resolve(code)
      })
    })
    if (this.stopped) throw new Error('Server stopped')
    let result: { warnings?: unknown[]; error?: string }
    try {
      result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'))
    } catch {
      throw new Error('Build worker exited without a result. Publish again to retry.')
    }
    if (code !== 0 || result.error) throw new Error(result.error ?? 'Build worker failed')
    return result.warnings ?? []
  }

  close() {
    this.stopped = true
    clearInterval(this.timer)
    this.child?.kill('SIGKILL')
    this.sqlite
      .prepare(
        "UPDATE releases SET status='failed',error='Build interrupted by server shutdown. Publish again to retry.',finished_at=?,owner=NULL,lease_until=NULL WHERE owner=? AND status='building'",
      )
      .run(Date.now(), this.owner)
  }
}
