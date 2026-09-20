import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../../', import.meta.url))
try {
  loadEnvFile(path.join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
