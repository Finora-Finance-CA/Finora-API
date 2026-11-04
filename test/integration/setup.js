// Runs before every integration test file. Unlike test/setup.js, src/db.js is NOT
// replaced: the tests use the real pg pool on the local test database. Only the
// Supabase token check is faked, with the same fixed users as the unit tests.

import { afterAll, beforeEach, expect, vi } from 'vitest';
import { resetFakeAuth, ALICE, BOB } from '../support/fakeAuth.js';
import { localTestDatabaseUrl } from '../support/testDatabaseGuard.js';
import { ALICE_ID, BOB_ID } from './users.js';

// Belt and braces: vitest.integration.config.js already set DATABASE_URL to the
// checked TEST_DATABASE_URL. Stop before any test if something changed it.
if (process.env.DATABASE_URL !== localTestDatabaseUrl(process.env.TEST_DATABASE_URL)) {
  throw new Error('Refusing to run the integration tests: DATABASE_URL is not the checked TEST_DATABASE_URL.');
}

vi.mock('../../src/auth/supabaseTokens.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifySupabaseToken: (await import('../support/fakeAuth.js')).verifySupabaseToken,
}));

const { pool } = await import('../../src/db.js');

// The fake users must be the ones globalSetup put in auth.users.
expect([ALICE.id, BOB.id]).toEqual([ALICE_ID, BOB_ID]);

beforeEach(async () => {
  resetFakeAuth();
  await pool.query('TRUNCATE public.transactions, public.budgets, public.goals RESTART IDENTITY');
});

afterAll(async () => {
  await pool.end();
});
