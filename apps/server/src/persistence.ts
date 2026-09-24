import path from 'node:path'
import { type Persistence, StaleRevisionError } from '@freeflow/document'
import { FolderPersistence } from '@freeflow/document/folder'
import type { Document } from '@freeflow/schema'
import { and, eq } from 'drizzle-orm'
import { type SiteDatabase, sites } from './database.js'

/** Each request loads a fresh snapshot; the conditional UPDATE also protects across processes. */
export class SqlitePersistence implements Persistence {
  private loadedRevision: number | undefined
  private assets: FolderPersistence

  constructor(
    private db: SiteDatabase,
    private siteId: string,
    dataDir: string,
  ) {
    this.assets = new FolderPersistence(path.join(dataDir, 'sites', siteId))
  }

  async load(): Promise<unknown> {
    const row = this.db.select().from(sites).where(eq(sites.id, this.siteId)).get()
    this.loadedRevision = row?.revision
    return row ? JSON.parse(row.document) : undefined
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
  }

  putAsset(bytes: Uint8Array, hash: string): Promise<void> {
    return this.assets.putAsset(bytes, hash)
  }
}
