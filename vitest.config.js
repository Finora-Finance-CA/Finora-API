import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // The integration tests need a real local Postgres and run only with
    // npm run test:integration (vitest.integration.config.js).
    exclude: [...configDefaults.exclude, 'test/integration/**'],
    // Swaps the database and Supabase token check for in-memory fakes before any app
    // code loads, and resets them before each test.
    setupFiles: ['test/setup.js'],
    // Blank out real connection settings, so anything that slipped past the fakes
    // would fail instead of reaching the shared database or Supabase.
    env: {
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      // CORS tests pass their own list to createApp().
      CLIENT_ORIGIN: '',
    },
    restoreMocks: true,
  },
});
