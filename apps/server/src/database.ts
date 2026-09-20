import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().unique(),
  name: text('name').notNull(),
})

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  document: text('document').notNull(),
  revision: integer('revision').notNull(),
})

export function openDatabase(dataDir: string): {
  sqlite: Database.Database
  db: BetterSQLite3Database
} {
  mkdirSync(dataDir, { recursive: true })
  const sqlite = new Database(path.join(dataDir, 'freeflow.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite) }
}

export type SiteDatabase = ReturnType<typeof openDatabase>['db']

/** Auth owns its migrations; this ledger versions Freeflow's application tables separately. */
export function migrateApplication(sqlite: Database.Database) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS freeflow_migrations (version INTEGER PRIMARY KEY)')
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM freeflow_migrations WHERE version = 1').get()) return
      sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      );
      CREATE TABLE sites (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        document TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0)
      );
      CREATE INDEX sites_workspace_id ON sites(workspace_id);
      INSERT INTO freeflow_migrations (version) VALUES (1);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM freeflow_migrations WHERE version = 2').get()) return
      sqlite.exec(`
      CREATE TABLE releases (
        id TEXT PRIMARY KEY NOT NULL,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        document TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','building','ready','failed')),
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT,
        warnings TEXT NOT NULL DEFAULT '[]',
        owner TEXT,
        lease_until INTEGER
      );
      CREATE INDEX releases_site_created ON releases(site_id, created_at DESC);
      CREATE UNIQUE INDEX releases_one_active ON releases(site_id) WHERE status IN ('queued','building');
      CREATE TABLE publications (
        site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        release_id TEXT NOT NULL REFERENCES releases(id)
      );
      INSERT INTO freeflow_migrations(version) VALUES(2);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM freeflow_migrations WHERE version = 3').get()) return
      sqlite.exec(`
      ALTER TABLE releases ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY site_id ORDER BY created_at, rowid) AS version
        FROM releases
      )
      UPDATE releases SET version = (SELECT version FROM numbered WHERE numbered.id = releases.id);
      CREATE UNIQUE INDEX releases_site_version ON releases(site_id, version);
      INSERT INTO freeflow_migrations(version) VALUES(3);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM freeflow_migrations WHERE version = 4').get()) return
      sqlite.exec(`
      CREATE TABLE owner_setup (id INTEGER PRIMARY KEY CHECK(id = 1), token TEXT);
      INSERT INTO freeflow_migrations(version) VALUES(4);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM freeflow_migrations WHERE version=5').get()) return
      sqlite.exec(`
      CREATE TABLE gateway_mode (id INTEGER PRIMARY KEY CHECK(id=1),issuer TEXT NOT NULL,audience TEXT NOT NULL);
      CREATE TABLE gateway_nonce (id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE INDEX gateway_nonce_expiry ON gateway_nonce(expires_at);
      INSERT INTO freeflow_migrations(version) VALUES(5);
    `)
    })
    .immediate()
}
