// US-62: the whole npm run seed:perf run, with a fake Supabase `auth` and the in-memory
// database. It must never run in production, never duplicate rows when run again, and
// never touch anything but the demo user's perf rows.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedError } from '../../scripts/seed/errors.js';
import { PERF_CREATED_AT_START } from '../../scripts/seed/perfTransactions.js';
import { replacePerfTransactions } from '../../scripts/seed/replacePerfTransactions.js';
import { seedPerfData } from '../../scripts/seed/seedPerfData.js';
import { addRows, openClientCount, pool, recordedQueries, storedRows } from '../support/fakeDatabase.js';

const TODAY = '2026-11-16';
const DEMO_ID = '5b1f7c3a-2d4e-4f6a-8b9c-0d1e2f3a4b5c';
const OTHER_ID = '6c2a8d4b-3e5f-4a7b-9c0d-1e2f3a4b5c6d';
const ENV = {
  DATABASE_URL: 'postgresql://local/test',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SEED_USER_1_EMAIL: 'demo@example.com',
  SEED_USER_1_PASSWORD: 'demo-password',
  SEED_USER_2_EMAIL: 'second@example.com',
  SEED_USER_2_PASSWORD: 'second-password',
};

function fakeAuth() {
  return {
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: DEMO_ID }, session: {} }, error: null })),
    signUp: vi.fn(),
  };
}

let auth;
let getPool;
const run = (options = {}) =>
  seedPerfData({ env: ENV, getAuth: () => auth, getPool, today: TODAY, ...options });

const perfRowsOf = (userId) => storedRows().filter((row) => row.user_id === userId && row.created_at < '2002');

beforeEach(() => {
  auth = fakeAuth();
  getPool = vi.fn(async () => pool);
});

describe('seedPerfData', () => {
  it('gives the first sample user 1,000 transactions', async () => {
    const result = await run();

    expect(result).toEqual({ email: 'demo@example.com', removed: 0, inserted: 1000 });
    expect(perfRowsOf(DEMO_ID)).toHaveLength(1000);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'demo@example.com', password: 'demo-password' });
  });

  it('replaces the set when run again, so there are never more than 1,000', async () => {
    await run();
    const second = await run();
    const third = await run();

    expect(second).toMatchObject({ removed: 1000, inserted: 1000 });
    expect(third).toMatchObject({ removed: 1000, inserted: 1000 });
    expect(perfRowsOf(DEMO_ID)).toHaveLength(1000);
  });

  it('never touches the demo user’s own transactions or anyone else’s', async () => {
    addRows(
      { user_id: DEMO_ID, amount_cents: 1250, date: '2026-11-01', type: 'expense', category: 'Food', description: 'Real lunch' },
      { user_id: OTHER_ID, amount_cents: 999, date: '2026-11-02', type: 'expense', category: 'Other', description: 'Someone else' }
    );

    await run();
    await run();

    const descriptions = storedRows().map((row) => row.description);
    expect(descriptions).toContain('Real lunch');
    expect(descriptions).toContain('Someone else');
    expect(storedRows()).toHaveLength(1002);
  });

  it('removes only the perf rows with remove', async () => {
    addRows({ user_id: DEMO_ID, amount_cents: 1250, date: '2026-11-01', type: 'expense', category: 'Food', description: 'Real lunch' });
    await run();

    const result = await run({ remove: true });

    expect(result).toMatchObject({ removed: 1000, inserted: 0 });
    expect(storedRows().map((row) => row.description)).toEqual(['Real lunch']);
  });

  it('writes in one database transaction and returns the connection', async () => {
    await run();

    const statements = recordedQueries().map(({ sql }) => sql.split(' ').slice(0, 2).join(' '));
    expect(statements).toEqual(['BEGIN', 'DELETE FROM', 'INSERT INTO', 'COMMIT']);
    expect(recordedQueries()[1].params).toEqual([DEMO_ID, PERF_CREATED_AT_START, '2001-01-02T00:00:00.000Z']);
    expect(openClientCount()).toBe(0);
  });

  it.each(['production', 'Production ', 'PRODUCTION'])('refuses to run when NODE_ENV is %j, before doing anything', async (nodeEnv) => {
    const error = await run({ env: { ...ENV, NODE_ENV: nodeEnv } }).catch((err) => err);

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toMatch(/production/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
    expect(recordedQueries()).toEqual([]);
  });

  it('stops with the missing variables named, before doing anything', async () => {
    const { SEED_USER_1_PASSWORD: _, ...env } = ENV;

    await expect(run({ env })).rejects.toThrow('SEED_USER_1_PASSWORD');
    expect(getPool).not.toHaveBeenCalled();
  });

  it('writes nothing if the demo user cannot sign in', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'over_request_rate_limit', status: 429 } });

    await expect(run()).rejects.toBeInstanceOf(SeedError);
    expect(getPool).not.toHaveBeenCalled();
    expect(storedRows()).toEqual([]);
  });
});

describe('replacePerfTransactions', () => {
  it('refuses a row that is not marked as a perf row, before connecting', async () => {
    const row = { amount_cents: 100, date: '2026-11-01', type: 'expense', category: 'Food', description: 'x', created_at: '2026-11-01T00:00:00Z' };

    await expect(replacePerfTransactions(pool, DEMO_ID, [row])).rejects.toBeInstanceOf(SeedError);
    expect(recordedQueries()).toEqual([]);
  });

  it('refuses a row a user could not have entered, before connecting', async () => {
    const row = { amount_cents: 0, date: '2026-11-01', type: 'expense', category: 'Food', description: 'x', created_at: PERF_CREATED_AT_START };

    await expect(replacePerfTransactions(pool, DEMO_ID, [row])).rejects.toThrow('Amount must be greater than 0.');
    expect(recordedQueries()).toEqual([]);
  });
});
