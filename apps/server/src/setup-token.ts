import path from 'node:path'
import Database from 'better-sqlite3'
import { root } from './environment.js'

const file = path.join(path.resolve(root, process.env.LACUNO_DATA_DIR ?? 'data'), 'lacuno.sqlite')
let sqlite: Database.Database | undefined
try {
  sqlite = new Database(file, { readonly: true, fileMustExist: true })
  const row = sqlite
    .prepare('SELECT token FROM owner_setup WHERE id=1 AND NOT EXISTS(SELECT 1 FROM user)')
    .get() as { token: string | null } | undefined
  if (!row?.token) throw new Error('No owner setup is pending.')
  console.log(row.token)
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Cannot read setup token. Start the server first.',
  )
  process.exitCode = 1
} finally {
  sqlite?.close()
}
