import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // page.screenshot loads Playwright only when it is installed.
  external: ['playwright'],
  dts: false,
  fixedExtension: false,
}

export default defineConfig([
  {
    ...shared,
    entry: [
      'src/main.ts',
      'src/build-worker.ts',
      'src/setup-token.ts',
      'src/backup-cli.ts',
      'src/published-main.ts',
      'src/auth-migrate.ts',
    ],
    noExternal: [/^@lacuno\//],
    clean: true,
    // The MCP server reads the page view beside its own module, in source and in the bundle.
    copy: ['../../packages/mcp/src/page-view.html', '../../packages/mcp/src/editor-view.html'],
  },
  // The screenshots image installs only Playwright, so everything else is bundled in.
  { ...shared, entry: ['src/screenshot-main.ts'], noExternal: (id) => id !== 'playwright' },
])
