import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/main.ts',
    'src/build-worker.ts',
    'src/setup-token.ts',
    'src/backup-cli.ts',
    'src/published-main.ts',
    'src/auth-migrate.ts',
  ],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  noExternal: [/^@lacuno\//],
  // page.screenshot loads Playwright only when it is installed.
  external: ['playwright'],
  dts: false,
  clean: true,
  fixedExtension: false,
})
