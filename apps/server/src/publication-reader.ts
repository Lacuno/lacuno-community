import path from 'node:path'
import type Database from 'better-sqlite3'

export type Target = 'production' | 'testing'

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
  url(siteId: string, target: Target = 'production') {
    const url = new URL(this.base)
    url.hostname = `${siteId}${target === 'testing' ? '-testing' : ''}.${url.hostname}`
    return url.origin
  }
  siteForHost(hostname: string): { siteId: string; target: Target } | undefined {
    const suffix = `.${this.base.hostname}`
    if (!hostname.endsWith(suffix)) return
    const match = hostname.slice(0, -suffix.length).match(/^([0-9a-f-]{36})(-testing)?$/)
    if (match) return { siteId: match[1]!, target: match[2] ? 'testing' : 'production' }
  }
  directory(siteId: string, releaseId: string) {
    return path.join(this.dataDir, 'builds', siteId, releaseId)
  }
  current(siteId: string, target: Target = 'production'): string | null {
    return (
      (
        this.sqlite
          .prepare('SELECT release_id FROM publications WHERE site_id = ? AND target = ?')
          .get(siteId, target) as { release_id: string } | undefined
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
  /** `--list` prints the production rows; the cloud runtime parses exactly this shape. */
  publications() {
    return this.sqlite
      .prepare(
        "SELECT site_id AS siteId, release_id AS releaseId FROM publications WHERE target = 'production' ORDER BY site_id",
      )
      .all() as { siteId: string; releaseId: string }[]
  }
}
