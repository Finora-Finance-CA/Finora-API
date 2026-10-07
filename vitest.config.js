import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Swaps the database and Supabase token check for in-memory fakes before any app
    // code loads, and resets them before each test.
    setupFiles: ['test/setup.js'],
    // Blank out real connection settings, so anything that slipped past the fakes
    // would fail instead of reaching the shared database or Supabase.
    env: {
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
    },
    restoreMocks: true,
  },
});
