import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
const contents = template.replace('GENERATE_ON_SETUP', randomBytes(32).toString('hex'))

try {
  await writeFile(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 })
  console.log('Created .env with local defaults and a random auth secret. Run pnpm dev to start.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.log('.env already exists; kept your settings and auth secret unchanged.')
}
