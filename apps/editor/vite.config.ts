import { readdir, readFile } from 'node:fs/promises'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const templateAssets = new URL('../../templates/lacuno/assets/', import.meta.url)

export default defineConfig({
  plugins: [
    react(),
    {
      // The try worker seeds a browser site from the default template, whose bytes it fetches.
      name: 'template-assets',
      apply: 'build',
      async generateBundle() {
        for (const hash of await readdir(templateAssets))
          this.emitFile({
            type: 'asset',
            fileName: `template/${hash}`,
            source: await readFile(new URL(hash, templateAssets)),
          })
      },
    },
  ],
  build: {
    target: 'es2023',
    rolldownOptions: { input: ['index.html', 'try.html'] },
  },
  // The try page's service worker, at a fixed root path so its scope is the whole origin.
  worker: { rolldownOptions: { output: { entryFileNames: 'try-worker.js' } } },
})
