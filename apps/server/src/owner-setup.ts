import { randomBytes, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

/** New private instances get one owner. Existing accounts and explicit open signup are preserved. */
export class OwnerSetup {
  constructor(
    private sqlite: Database.Database,
    allowSignup: boolean,
  ) {
    sqlite
      .transaction(() => {
        if (!allowSignup && !this.hasUser()) {
          sqlite
            .prepare('INSERT OR IGNORE INTO owner_setup(id,token) VALUES(1,?)')
            .run(randomBytes(32).toString('hex'))
          // The database, not a process-local check, arbitrates simultaneous owner submissions.
          sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS lacuno_single_owner ON user ((1))')
        }
        if (this.hasUser()) this.complete()
      })
      .immediate()
  }

  /** Gateway mode replaces local owner setup; the caller must have verified there are no accounts. */
  static disable(sqlite: Database.Database) {
    sqlite.exec('DROP INDEX IF EXISTS lacuno_single_owner; DELETE FROM owner_setup;')
  }

  private hasUser() {
    return !!this.sqlite.prepare('SELECT id FROM user LIMIT 1').get()
  }

  get singleOwner() {
    return !!this.sqlite.prepare('SELECT id FROM owner_setup WHERE id=1').get()
  }

  get required() {
    return this.singleOwner && !this.hasUser()
  }

  accepts(token: string) {
    if (!this.required) return false
    const row = this.sqlite.prepare('SELECT token FROM owner_setup WHERE id=1').get() as {
      token: string | null
    }
    return (
      !!row.token &&
      /^[a-f0-9]{64}$/.test(token) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(row.token))
    )
  }

  complete() {
    this.sqlite.prepare('UPDATE owner_setup SET token=NULL WHERE id=1').run()
    // A workspace imported from Lacuno Cloud (backup.ts) goes to the owner.
    this.sqlite
      .prepare(
        'UPDATE workspaces SET owner_id=(SELECT id FROM user LIMIT 1) WHERE owner_id NOT IN (SELECT id FROM user)',
      )
      .run()
  }
}
