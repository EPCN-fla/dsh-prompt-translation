import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Temporary consumer checkouts under artifacts/ must not become test suites.
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
