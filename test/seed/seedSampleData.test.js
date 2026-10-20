// The whole seed run with a fake Supabase `auth` and the in-memory database.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSeedConfig } from '../../scripts/seed/config.js';
import { SeedError } from '../../scripts/seed/errors.js';
import { generateSampleTransactions, SAMPLE_PROFILES } from '../../scripts/seed/sampleTransactions.js';
import { seedSampleData } from '../../scripts/seed/seedSampleData.js';
import { addRows, pool, recordedQueries, storedRows } from '../support/fakeDatabase.js';

const TODAY = '2026-10-06';
const USERS = [
  { email: 'sample.one@example.com', password: 'first-password' },
  { email: 'sample.two@example.com', password: 'second-password' },
];
const IDS = {
  'sample.one@example.com': '5b1f7c3a-2d4e-4f6a-8b9c-0d1e2f3a4b5c',
  'sample.two@example.com': '6c2a8d4b-3e5f-4a7b-9c0d-1e2f3a4b5c6d',
};
const INVALID_CREDENTIALS = { data: { user: null, session: null }, error: { code: 'invalid_credentials', status: 400 } };

// Behaves like Supabase Auth with email confirmation off: accounts in `existing` can
// sign in; anyone else can sign up.
function fakeAuth(existing) {
  return {
    signInWithPassword: vi.fn(async ({ email }) =>
      existing.has(email) ? { data: { user: { id: IDS[email] }, session: {} }, error: null } : INVALID_CREDENTIALS
    ),
    signUp: vi.fn(async ({ email }) => ({
      data: { user: { id: IDS[email], identities: [{ provider: 'email' }] }, session: {} },
      error: null,
    })),
  };
}

const run = (auth) => seedSampleData({ users: USERS, auth, pool, today: TODAY });

let auth;
beforeEach(() => {
  auth = fakeAuth(new Set());
});

describe('seedSampleData', () => {
  it('creates both users and loads their sample transactions', async () => {
    const result = await run(auth);

    const counts = SAMPLE_PROFILES.map((profile) => profile.length);
    expect(result).toEqual({
      users: [
        { email: USERS[0].email, created: true, transactionCount: counts[0] },
        { email: USERS[1].email, created: true, transactionCount: counts[1] },
      ],
      removed: 0,
      inserted: counts[0] + counts[1],
    });
    expect(storedRows()).toHaveLength(counts[0] + counts[1]);
  });

  it('gives user N the sample profile N', async () => {
    await run(auth);

    for (const [index, { email }] of USERS.entries()) {
      const descriptions = storedRows()
        .filter((row) => row.user_id === IDS[email])
        .map((row) => row.description)
        .sort();
      const expected = generateSampleTransactions(index, TODAY).map((t) => t.description).sort();
      expect(descriptions).toEqual(expected);
    }
  });

  it('reuses existing accounts and resets their transactions on a second run', async () => {
    await run(auth);
    const afterFirstRun = storedRows().length;

    const result = await run(fakeAuth(new Set(Object.keys(IDS))));

    expect(result.users.map((user) => user.created)).toEqual([false, false]);
    expect(result.removed).toBe(afterFirstRun);
    expect(storedRows()).toHaveLength(afterFirstRun);
  });

  it('writes nothing when the second user fails in Supabase', async () => {
    addRows({ user_id: IDS['sample.one@example.com'], amount_cents: 500, date: '2026-10-01', type: 'income', description: 'Old' });
    const before = storedRows();
    auth.signUp.mockImplementation(async ({ email }) =>
      email === USERS[1].email
        ? { data: { user: null, session: null }, error: { code: 'over_request_rate_limit', status: 429 } }
        : { data: { user: { id: IDS[email], identities: [{}] }, session: {} }, error: null }
    );

    await expect(run(auth)).rejects.toBeInstanceOf(SeedError);

    expect(recordedQueries()).toEqual([]);
    expect(storedRows()).toEqual(before);
  });
});

describe('sample users and sample profiles', () => {
  it('has a sample profile for every sample user the settings define', () => {
    const { users } = readSeedConfig({
      DATABASE_URL: 'postgresql://localhost/finora',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
      SEED_USER_1_EMAIL: USERS[0].email,
      SEED_USER_1_PASSWORD: USERS[0].password,
      SEED_USER_2_EMAIL: USERS[1].email,
      SEED_USER_2_PASSWORD: USERS[1].password,
    });

    expect(users).toHaveLength(SAMPLE_PROFILES.length);
  });
});
