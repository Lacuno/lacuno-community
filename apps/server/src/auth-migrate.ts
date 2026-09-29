import { migrateAuth } from './auth.js'
import { openDatabase } from './database.js'

// node auth-migrate.js <data directory>: Better Auth's migrations, run in a child process at start.
const { sqlite } = openDatabase(process.argv[2]!)
await migrateAuth(sqlite)
sqlite.close()
