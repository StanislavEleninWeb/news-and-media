import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { APP_ENV: 'test', APP_URL: 'http://localhost:3000' },
  },
});
