import path from 'node:path'
import { type Persistence, StaleRevisionError } from '@lacuno/document'
import { FolderPersistence } from '@lacuno/document/folder'
import type { Document } from '@lacuno/schema'
import { and, eq, sql } from 'drizzle-orm'
import { type SiteDatabase, sites } from './database.js'
import { assetList, type ExportOptions, exportAsset, exportReport } from './export.js'

/** Each request loads a fresh snapshot; the conditional UPDATE also protects across processes. */
export class SqlitePersistence implements Persistence {
  private loadedRevision: number | undefined
  private loadedAssets: string | undefined
  private loadedName: string | undefined
  private assets: FolderPersistence

  constructor(
    private db: SiteDatabase,
    private siteId: string,
    dataDir: string,
    private exportOptions?: ExportOptions,
  ) {
    this.assets = new FolderPersistence(path.join(dataDir, 'sites', siteId))
  }

  async load(): Promise<unknown> {
    const row = this.db.select().from(sites).where(eq(sites.id, this.siteId)).get()
    this.loadedRevision = row?.revision
    this.loadedName = row?.name
    const document = row && JSON.parse(row.document)
    this.loadedAssets = document && assetList(document)
    return document
  }

  async save(document: Document): Promise<void> {
    if (this.loadedRevision === undefined) throw new Error('Load a site before saving it')
    const result = this.db
      .update(sites)
      .set({
        document: JSON.stringify(document),
        name: document.site.name,
        revision: document.revision,
      })
      .where(and(eq(sites.id, this.siteId), eq(sites.revision, this.loadedRevision)))
      .run()
    if (result.changes !== 1) {
      const current = this.db
        .select({ revision: sites.revision })
        .from(sites)
        .where(eq(sites.id, this.siteId))
        .get()
      if (!current) throw new Error('Site disappeared while saving')
      throw new StaleRevisionError(this.loadedRevision, current.revision)
    }
    this.loadedRevision = document.revision
    // Cloud counts the assets a site lists as its storage; the exporter sends it the new list.
    const assets = assetList(document)
    if (this.exportOptions && assets !== this.loadedAssets)
      this.db.run(
        sql`INSERT INTO export_assets(site_id) VALUES(${this.siteId})
        ON CONFLICT(site_id) DO UPDATE SET attempts=0,next_attempt_at=0`,
      )
    this.loadedAssets = assets
    if (this.exportOptions && document.site.name !== this.loadedName)
      void exportReport(this.exportOptions, this.siteId, 'meta', { name: document.site.name })
    this.loadedName = document.site.name
  }

  /** With the export sink, returns only once Cloud keeps the bytes too. */
  async putAsset(bytes: Uint8Array, hash: string): Promise<void> {
    await this.assets.putAsset(bytes, hash)
    if (this.exportOptions) await exportAsset(this.exportOptions, this.siteId, hash, bytes)
  }
}
