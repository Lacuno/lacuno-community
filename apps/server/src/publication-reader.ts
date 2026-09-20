import path from 'node:path'
import type Database from 'better-sqlite3'

/** Read-only publication metadata, shared by the editor and standalone publishing process. */
export class PublicationReader {
  readonly dataDir: string
  private base: URL
  constructor(
    protected sqlite: Database.Database,
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
  readyIds(siteId: string) {
    return (
      this.sqlite
        .prepare(
          "SELECT id FROM releases WHERE site_id = ? AND status = 'ready' ORDER BY created_at DESC, rowid DESC",
        )
        .all(siteId) as { id: string }[]
    ).map((row) => row.id)
  }
  publications() {
    return this.sqlite
      .prepare(
        'SELECT site_id AS siteId, release_id AS releaseId FROM publications ORDER BY site_id',
      )
      .all() as { siteId: string; releaseId: string }[]
  }
}
