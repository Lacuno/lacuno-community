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
  const sqlite = new Database(path.join(dataDir, 'lacuno.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite) }
}

export type SiteDatabase = ReturnType<typeof openDatabase>['db']

/** Auth owns its migrations; this ledger versions Lacuno's application tables separately. */
export function migrateApplication(sqlite: Database.Database) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS lacuno_migrations (version INTEGER PRIMARY KEY)')
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 1').get()) return
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
      CREATE TABLE releases (
        id TEXT PRIMARY KEY NOT NULL,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version > 0),
        name TEXT,
        target TEXT NOT NULL DEFAULT 'production' CHECK(target IN ('production','testing')),
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
      CREATE UNIQUE INDEX releases_site_version ON releases(site_id, version);
      CREATE TABLE publications (
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK(target IN ('production','testing')),
        release_id TEXT NOT NULL REFERENCES releases(id),
        PRIMARY KEY(site_id, target)
      );
      CREATE TABLE owner_setup (id INTEGER PRIMARY KEY CHECK(id = 1), token TEXT);
      CREATE TABLE gateway_mode (id INTEGER PRIMARY KEY CHECK(id = 1), issuer TEXT NOT NULL, audience TEXT NOT NULL);
      CREATE TABLE gateway_nonce (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE INDEX gateway_nonce_expiry ON gateway_nonce(expires_at);
      INSERT INTO lacuno_migrations (version) VALUES (1);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 2').get()) return
      sqlite.exec(`
      CREATE TABLE export_pointer (
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK(target IN ('production','testing')),
        release_id TEXT NOT NULL REFERENCES releases(id),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(site_id, target)
      );
      CREATE TABLE exported_release (
        release_id TEXT PRIMARY KEY NOT NULL REFERENCES releases(id) ON DELETE CASCADE
      );
      INSERT INTO lacuno_migrations (version) VALUES (2);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 3').get()) return
      // Sites whose asset list the exporter owes the sink, starting with every existing one.
      sqlite.exec(`
      CREATE TABLE export_assets (
        site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO export_assets(site_id) SELECT id FROM sites;
      INSERT INTO lacuno_migrations (version) VALUES (3);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 4').get()) return
      // Each gateway user's role as last asserted, for the MCP requests that carry none.
      sqlite.exec(`
      CREATE TABLE gateway_role (
        user_id TEXT PRIMARY KEY NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer'))
      );
      INSERT INTO lacuno_migrations (version) VALUES (4);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 5').get()) return
      // Each site's home page as an editor last drew it, for the site list (editor thumbnail.ts).
      sqlite.exec(`
      CREATE TABLE site_thumbnail (
        site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        image BLOB NOT NULL
      );
      INSERT INTO lacuno_migrations (version) VALUES (5);
    `)
    })
    .immediate()
  sqlite
    .transaction(() => {
      if (sqlite.prepare('SELECT version FROM lacuno_migrations WHERE version = 6').get()) return
      // The origin a gateway gave a site, such as its primary custom domain, and the origin each
      // release was built with (releases.ts); an older release was built with the published address.
      sqlite.exec(`
      CREATE TABLE site_origin (
        site_id TEXT PRIMARY KEY NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        origin TEXT NOT NULL
      );
      ALTER TABLE releases ADD COLUMN origin TEXT;
      INSERT INTO lacuno_migrations (version) VALUES (6);
    `)
    })
    .immediate()
}
