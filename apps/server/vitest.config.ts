import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // Browser tests poll the editor; one second is too short for a save or a canvas morph.
    expect: { poll: { timeout: 8000 } },
  },
})
