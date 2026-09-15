import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Workspace packages are TypeScript source, so they must be inlined. Everything else stays
  // external and resolves from node_modules at runtime.
  noExternal: [/^@freeflow\//],
  dts: false,
  clean: true,
  // tsdown defaults to a fixed .mjs extension on the node platform regardless of the package's
  // own "type", which would not match the "./dist/main.js" the package.json bin field names.
  fixedExtension: false,
})
