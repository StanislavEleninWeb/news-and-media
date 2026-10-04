import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PGlite databases and local HTTP fixtures are created per file; keep files isolated.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
