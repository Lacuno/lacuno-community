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
}
