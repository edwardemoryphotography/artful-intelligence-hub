import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Everything under test is pure logic plus migration-file parsing —
    // no DOM, no network, no database. Deliberately so: these must run in CI
    // without credentials.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
