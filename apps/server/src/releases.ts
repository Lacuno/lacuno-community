import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashAsset, parseDocument } from '@lacuno/schema'
import type Database from 'better-sqlite3'
import { HTTPException } from 'hono/http-exception'
import { buildSlot, Exporter, type ExportOptions } from './export.js'
import { PublicationReader, type Target } from './publication-reader.js'

type ReleaseRow = {
  id: string
  site_id: string
  revision: number
  version: number
  name: string | null
  target: Target
  document: string
  status: 'queued' | 'building' | 'ready' | 'failed'
  created_at: number
  finished_at: number | null
  error: string | null
  warnings: string
  owner: string | null
  lease_until: number | null
  /** The origin it links to, set when its build starts; null in releases from before. */
  origin: string | null
}
const conflict = (message: string) => new HTTPException(409, { message })
const leaseMs = 30_000

/** Durable release queue. SQLite claims serialize each site even with multiple API instances. */
export class Releases extends PublicationReader {
  private owner = randomUUID()
  private stopped = false
  private running = false
  private timer: ReturnType<typeof setInterval>
  private child: ChildProcess | undefined
  private exporter: Exporter | undefined
  /** The release waiting for one of Cloud's build slots, which the history shows as `waiting`. */
  private waiting: string | undefined

  constructor(
    sqlite: Database.Database,
    dataDir: string,
    baseURL: string,
    private exportOptions?: ExportOptions,
  ) {
    super(sqlite, dataDir, baseURL)
    this.exporter =
      exportOptions &&
      new Exporter(sqlite, exportOptions, (siteId, id) =>
        path.join(this.directory(siteId, id), 'dist'),
      )
    this.timer = setInterval(() => {
      void this.tick()
    }, 1000)
    this.timer.unref()
    queueMicrotask(() => {
      void this.tick()
    })
  }

  list(siteId: string) {
    const rows = this.sqlite
      .prepare(
        'SELECT id,revision,version,name,target,status,created_at,finished_at,error,warnings FROM releases WHERE site_id = ? ORDER BY version DESC',
      )
      .all(siteId) as Omit<
      ReleaseRow,
      'document' | 'site_id' | 'owner' | 'lease_until' | 'origin'
    >[]
    return {
      enabled: true,
      publishedId: this.current(siteId),
      url: this.origin(siteId),
      testingId: this.current(siteId, 'testing'),
      testingUrl: this.url(siteId, 'testing'),
      releases: rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        version: row.version,
        name: row.name,
        target: row.target,
        status: row.id === this.waiting && row.status === 'building' ? 'waiting' : row.status,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        error: row.error,
        warnings: JSON.parse(row.warnings) as { node?: string; message: string }[],
      })),
    }
  }

  publish(
    siteId: string,
    revision: number,
    expectedId: string | null,
    name: string | null,
    target: Target,
  ) {
    const id = this.sqlite
      .transaction(() => {
        this.checkPublication(siteId, expectedId, target)
        const site = this.sqlite
          .prepare('SELECT document, revision FROM sites WHERE id = ?')
          .get(siteId) as { document: string; revision: number }
        if (site.revision !== revision)
          throw conflict('The draft changed. Reload before publishing.')
        return this.queue(siteId, revision, site.document, name, target)
      })
      .immediate()
    void this.tick()
    return { id }
  }

  private queue(
    siteId: string,
    revision: number,
    document: string,
    name: string | null,
    target: Target,
  ) {
    const id = randomUUID()
    const { version } = this.sqlite
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM releases WHERE site_id = ?')
      .get(siteId) as { version: number }
    this.sqlite
      .prepare(
        "INSERT INTO releases(id,site_id,revision,version,name,target,document,status,created_at) VALUES(?,?,?,?,?,?,?,'queued',?)",
      )
      .run(id, siteId, revision, version, name, target, document, Date.now())
    return id
  }

  /** The origin a site's pages link to: the one its gateway set, else its published address. */
  origin(siteId: string) {
    const row = this.sqlite
      .prepare('SELECT origin FROM site_origin WHERE site_id = ?')
      .get(siteId) as { origin: string } | undefined
    return row?.origin ?? this.url(siteId)
  }

  /** Sets a site's origin (null: its published address) and brings its live release up to it. */
  setOrigin(siteId: string, origin: string | null) {
    this.sqlite
      .transaction(() => {
        if (!this.sqlite.prepare('SELECT id FROM sites WHERE id = ?').get(siteId))
          throw new HTTPException(404, { message: 'Site not found' })
        if (origin)
          this.sqlite
            .prepare(
              'INSERT INTO site_origin(site_id,origin) VALUES(?,?) ON CONFLICT(site_id) DO UPDATE SET origin=excluded.origin',
            )
            .run(siteId, origin)
        else this.sqlite.prepare('DELETE FROM site_origin WHERE site_id = ?').run(siteId)
        this.refresh(siteId)
      })
      .immediate()
    void this.tick()
  }

  /**
   * Builds the live release again, its same revision and document, when it links to another
   * origin than the site's now. Waits for a build in progress, which calls it again when it goes
   * live.
   */
  private refresh(siteId: string) {
    const live = this.sqlite
      .prepare(
        "SELECT r.revision,r.document,r.origin FROM publications p JOIN releases r ON r.id=p.release_id WHERE p.site_id=? AND p.target='production'",
      )
      .get(siteId) as Pick<ReleaseRow, 'revision' | 'document' | 'origin'> | undefined
    if (!live || (live.origin ?? this.url(siteId)) === this.origin(siteId)) return
    if (
      this.sqlite
        .prepare("SELECT id FROM releases WHERE site_id = ? AND status IN ('queued','building')")
        .get(siteId)
    )
      return
    this.queue(siteId, live.revision, live.document, null, 'production')
  }

  rename(siteId: string, id: string, name: string | null) {
    if (
      !this.sqlite
        .prepare('UPDATE releases SET name = ? WHERE id = ? AND site_id = ?')
        .run(name, id, siteId).changes
    )
      throw new HTTPException(404, { message: 'Release not found' })
  }

  private checkPublication(siteId: string, expected: string | null, target: Target) {
    if (this.current(siteId, target) !== expected)
      throw conflict('The published release changed. Refresh release history and try again.')
    if (
      this.sqlite
        .prepare("SELECT id FROM releases WHERE site_id = ? AND status IN ('queued','building')")
        .get(siteId)
    )
      throw conflict('A publish is already queued or building for this site.')
  }

  /** Points a target at a ready release without a build: rollback, promote or send to testing. */
  rollback(siteId: string, id: string, expected: string | null, target: Target) {
    this.sqlite
      .transaction(() => {
        this.checkPublication(siteId, expected, target)
        const release = this.sqlite
          .prepare("SELECT id FROM releases WHERE id = ? AND site_id = ? AND status = 'ready'")
          .get(id, siteId)
        if (!release) throw new HTTPException(404, { message: 'Successful release not found' })
        this.activate(siteId, id, target)
      })
      .immediate()
  }

  private activate(siteId: string, id: string, target: Target) {
    this.sqlite
      .prepare(
        'INSERT INTO publications(site_id,target,release_id) VALUES(?,?,?) ON CONFLICT(site_id,target) DO UPDATE SET release_id=excluded.release_id',
      )
      .run(siteId, target, id)
    this.exporter?.queue(siteId, target, id)
    this.refresh(siteId)
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
          if (row) {
            row.origin = this.origin(row.site_id)
            this.sqlite
              .prepare(
                "UPDATE releases SET status='building',owner=?,lease_until=?,origin=? WHERE id=?",
              )
              .run(this.owner, Date.now() + leaseMs, row.origin, row.id)
          }
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
      const started = Date.now()
      const warnings = await this.build(job)
      const built = Date.now()
      const sent = await this.exporter?.upload(job.site_id, id).catch((error) => {
        if (!this.stopped) console.error('Export of a release failed', error)
        throw new Error(
          'The site could not be copied to the edge, even after several tries. The live site is unchanged. Publish again to retry.',
        )
      })
      if (this.stopped) return
      console.log(
        `Release ${id} built in ${built - started} ms${sent ? `, uploaded in ${Date.now() - built} ms: ${sent.files} files, ${sent.bytes} bytes, ${sent.skipped} already there` : ''}`,
      )
      this.sqlite
        .transaction(() => {
          const result = this.sqlite
            .prepare(
              "UPDATE releases SET status='ready',finished_at=?,warnings=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=? AND status='building'",
            )
            .run(Date.now(), JSON.stringify(warnings), id, this.owner)
          if (result.changes) this.activate(job!.site_id, id, job!.target)
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
    const directory = this.directory(job.site_id, job.id)
    // A document with a successful release for the same origin already, as a draft just sent to
    // testing, is copied.
    const same = this.sqlite
      .prepare(
        "SELECT id,warnings FROM releases WHERE site_id=? AND revision=? AND document=? AND origin IS ? AND status='ready' ORDER BY version DESC LIMIT 1",
      )
      .get(job.site_id, job.revision, job.document, job.origin) as
      | { id: string; warnings: string }
      | undefined
    if (same) {
      const built = path.join(this.directory(job.site_id, same.id), 'dist')
      await cp(built, path.join(directory, 'dist'), { recursive: true })
      return JSON.parse(same.warnings)
    }
    const doc = parseDocument(JSON.parse(job.document))
    await mkdir(path.join(directory, 'assets'), { recursive: true })
    await writeFile(path.join(directory, 'lacuno.json'), JSON.stringify(doc))
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
    // Cloud runs only so many builds at once on the server; a build takes about 0.5 GB for seconds.
    let slot: Awaited<ReturnType<typeof buildSlot>> | undefined
    try {
      slot =
        this.exportOptions &&
        (await buildSlot(
          this.exportOptions,
          job.site_id,
          () => {
            this.waiting = job.id
          },
          () => this.stopped,
        ))
    } finally {
      this.waiting = undefined
    }
    try {
      return await this.spawn(job, directory, slot?.maxImageWidth)
    } finally {
      slot?.release()
    }
  }

  /** Builds a snapshot directory in a child process, whose memory leaves with it. */
  private async spawn(
    job: ReleaseRow,
    directory: string,
    maxImageWidth?: number,
  ): Promise<unknown[]> {
    const source = import.meta.url.endsWith('.ts')
    const worker = fileURLToPath(
      new URL(source ? './build-worker.ts' : './build-worker.js', import.meta.url),
    )
    const exited = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            // A runaway build fails alone: the default template's heap peaks at about 110 MB.
            '--max-old-space-size=384',
            ...(source ? ['--import', import.meta.resolve('tsx')] : []),
            worker,
            directory,
            job.origin!,
            // Optimized images carry over between the site's builds; backups leave them out.
            path.join(this.dataDir, 'builds', job.site_id, 'images'),
            ...(maxImageWidth ? [String(maxImageWidth)] : []),
          ],
          // libvips threads cost memory, not time, on a runtime's one CPU.
          { stdio: 'ignore', env: { ...process.env, VIPS_CONCURRENCY: '1' } },
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
        child.once('exit', (code, signal) => {
          clearTimeout(timeout)
          this.child = undefined
          resolve({ code, signal })
        })
      },
    )
    if (this.stopped) throw new Error('Server stopped')
    let result: { warnings?: unknown[]; error?: string }
    try {
      result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'))
    } catch {
      // Its output goes nowhere, so the kill (the kernel's, for memory) is named here.
      const how = exited.signal
        ? `was killed (${exited.signal}), probably out of memory`
        : `exited with code ${exited.code} and no result`
      console.error(`Build worker for release ${job.id} ${how}`)
      throw new Error(`Build worker ${how}. Publish again to retry.`)
    }
    if (exited.code !== 0 || result.error) throw new Error(result.error ?? 'Build worker failed')
    return result.warnings ?? []
  }

  close() {
    this.stopped = true
    clearInterval(this.timer)
    this.exporter?.close()
    this.child?.kill('SIGKILL')
    this.sqlite
      .prepare(
        "UPDATE releases SET status='failed',error='Build interrupted by server shutdown. Publish again to retry.',finished_at=?,owner=NULL,lease_until=NULL WHERE owner=? AND status='building'",
      )
      .run(Date.now(), this.owner)
  }
}
