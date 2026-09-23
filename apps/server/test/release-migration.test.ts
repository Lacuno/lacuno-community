import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { migrateApplication } from '../src/database.js'
import { PublicationReader } from '../src/publication-reader.js'

it('numbers existing releases per site chronologically without changing revisions or live pointers', () => {
  const sqlite = new Database(':memory:')
  try {
    // The columns used by migration 3, representing an existing pre-version database.
    sqlite.exec(`
      CREATE TABLE freeflow_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO freeflow_migrations VALUES(1),(2);
      CREATE TABLE releases(id TEXT PRIMARY KEY, site_id TEXT, revision INTEGER, created_at INTEGER);
      INSERT INTO releases VALUES('a-first','a',160,10),('b-first','b',500,5),('a-second','a',180,10);
      CREATE TABLE sites(id TEXT PRIMARY KEY);
      INSERT INTO sites VALUES('a'),('b');
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

it('adds an empty release name to databases from before names', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.exec(`
      CREATE TABLE freeflow_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO freeflow_migrations VALUES(1),(2),(3),(4),(5);
      CREATE TABLE releases(id TEXT PRIMARY KEY, site_id TEXT, version INTEGER);
      INSERT INTO releases VALUES('a-first','a',1);
      CREATE TABLE sites(id TEXT PRIMARY KEY);
      CREATE TABLE publications(site_id TEXT PRIMARY KEY, release_id TEXT);
    `)
    migrateApplication(sqlite)
    migrateApplication(sqlite)
    expect(sqlite.prepare('SELECT id,version,name FROM releases').all()).toEqual([
      { id: 'a-first', version: 1, name: null },
    ])
  } finally {
    sqlite.close()
  }
})

it('turns every existing publication into a production publication', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.exec(`
      CREATE TABLE freeflow_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO freeflow_migrations VALUES(1),(2),(3),(4),(5),(6);
      CREATE TABLE releases(id TEXT PRIMARY KEY, site_id TEXT);
      INSERT INTO releases VALUES('a-first','a');
      CREATE TABLE sites(id TEXT PRIMARY KEY);
      INSERT INTO sites VALUES('a');
      CREATE TABLE publications(site_id TEXT PRIMARY KEY, release_id TEXT);
      INSERT INTO publications VALUES('a','a-first');
    `)
    migrateApplication(sqlite)
    migrateApplication(sqlite)
    const reader = new PublicationReader(sqlite, '.', 'http://localhost:3001')
    expect(sqlite.prepare('SELECT site_id,target,release_id FROM publications').all()).toEqual([
      { site_id: 'a', target: 'production', release_id: 'a-first' },
    ])
    expect(sqlite.prepare('SELECT target FROM releases').get()).toEqual({ target: 'production' })
    expect(reader.current('a')).toBe('a-first')
    expect(reader.current('a', 'testing')).toBeNull()
    expect(reader.publications()).toEqual([{ siteId: 'a', releaseId: 'a-first' }])
  } finally {
    sqlite.close()
  }
})

it('renames staging publications and releases to testing', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.exec(`
      CREATE TABLE freeflow_migrations(version INTEGER PRIMARY KEY);
      INSERT INTO freeflow_migrations VALUES(1),(2),(3),(4),(5),(6),(7);
      CREATE TABLE sites(id TEXT PRIMARY KEY);
      INSERT INTO sites VALUES('a');
      CREATE TABLE releases(id TEXT PRIMARY KEY, site_id TEXT,
        target TEXT NOT NULL DEFAULT 'production' CHECK(target IN ('production','staging')));
      INSERT INTO releases VALUES('a-first','a','production'),('a-second','a','staging');
      CREATE TABLE publications (
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK(target IN ('production','staging')),
        release_id TEXT NOT NULL REFERENCES releases(id),
        PRIMARY KEY(site_id, target)
      );
      INSERT INTO publications VALUES('a','production','a-first'),('a','staging','a-second');
    `)
    migrateApplication(sqlite)
    migrateApplication(sqlite)
    const reader = new PublicationReader(sqlite, '.', 'http://localhost:3001')
    expect(sqlite.prepare('SELECT id,target FROM releases ORDER BY id').all()).toEqual([
      { id: 'a-first', target: 'production' },
      { id: 'a-second', target: 'testing' },
    ])
    expect(reader.current('a')).toBe('a-first')
    expect(reader.current('a', 'testing')).toBe('a-second')
    expect(reader.publications()).toEqual([{ siteId: 'a', releaseId: 'a-first' }])
    expect(() =>
      sqlite.prepare("UPDATE publications SET target='staging' WHERE target='testing'").run(),
    ).toThrow(/CHECK/)
    expect(() => sqlite.prepare("UPDATE releases SET target='staging'").run()).toThrow(/CHECK/)
  } finally {
    sqlite.close()
  }
})
