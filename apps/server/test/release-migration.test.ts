import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { migrateApplication } from '../src/database.js'

it('numbers existing releases per site chronologically without changing revisions or live pointers', () => {
  const sqlite = new Database(':memory:')
  try {
    // The columns used by migration 3, representing an existing pre-version database.
    sqlite.exec(`
      CREATE TABLE freeflow_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO freeflow_migrations VALUES(1),(2);
      CREATE TABLE releases(id TEXT PRIMARY KEY, site_id TEXT, revision INTEGER, created_at INTEGER);
      INSERT INTO releases VALUES('a-first','a',160,10),('b-first','b',500,5),('a-second','a',180,10);
      CREATE TABLE publications(site_id TEXT PRIMARY KEY, release_id TEXT);
      INSERT INTO publications VALUES('a','a-second');
    `)
    migrateApplication(sqlite)
    migrateApplication(sqlite)
    expect(sqlite.prepare('SELECT id,revision,version FROM releases ORDER BY id').all()).toEqual([
      { id: 'a-first', revision: 160, version: 1 },
      { id: 'a-second', revision: 180, version: 2 },
      { id: 'b-first', revision: 500, version: 1 },
    ])
    expect(sqlite.prepare('SELECT release_id FROM publications WHERE site_id=?').get('a')).toEqual({
      release_id: 'a-second',
    })
    expect(() =>
      sqlite.prepare('UPDATE releases SET version=1 WHERE id=?').run('a-second'),
    ).toThrow(/UNIQUE/)
  } finally {
    sqlite.close()
  }
})
