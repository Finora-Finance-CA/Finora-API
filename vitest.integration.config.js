// npm run test:integration: the API against a real, throwaway Postgres (US-45, US-46).
// Never run by npm test. See "Integration tests" in the README.

import { defineConfig } from 'vitest/config';
import { localTestDatabaseUrl } from './test/support/testDatabaseGuard.js';

// First, before anything can load src/db.js: refuse anything but a local test database,
// and give it to the tests as DATABASE_URL. Setting it here means dotenv (in db.js)
// can't fill it in from .env, which points at the shared Supabase database.
const DATABASE_URL = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.js'],
    // Wipes the database and applies every migration, once, before any test file.
    globalSetup: ['test/integration/globalSetup.js'],
    // Checks DATABASE_URL again, fakes the Supabase token check, and empties the user
    // tables before each test.
    setupFiles: ['test/integration/setup.js'],
    // One database for every file, so files run one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL,
      // Empty, so dotenv leaves them empty and nothing can reach Supabase.
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      CLIENT_ORIGIN: '',
    },
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
