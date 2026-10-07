// Runs before every test file (see vitest.config.js). Replaces src/db.js and the
// Supabase token check with in-memory fakes before any app code loads, so no test can
// reach the shared database or Supabase. The fakes are reset before each test, so
// tests don't depend on each other or on run order.

import { beforeEach, vi } from 'vitest';
import { resetFakeAuth } from './support/fakeAuth.js';
import { resetFakeDatabase } from './support/fakeDatabase.js';

vi.mock('../src/db.js', async () => (await import('./support/fakeDatabase.js')).fakeDbModule);

// Only verifySupabaseToken is replaced. InvalidTokenError stays the real class, so
// requireAuth's `instanceof` check behaves exactly as in production.
vi.mock('../src/auth/supabaseTokens.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifySupabaseToken: (await import('./support/fakeAuth.js')).verifySupabaseToken,
}));

beforeEach(() => {
  resetFakeDatabase();
  resetFakeAuth();
});
