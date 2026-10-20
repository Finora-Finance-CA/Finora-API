// replaceSampleTransactions against the in-memory database from test/setup.js.

import { describe, expect, it } from 'vitest';
import { SeedError } from '../../scripts/seed/errors.js';
import { replaceSampleTransactions } from '../../scripts/seed/replaceSampleTransactions.js';
import { generateSampleTransactions } from '../../scripts/seed/sampleTransactions.js';
import {
  addRows,
  failNextQuery,
  openClientCount,
  pool,
  recordedQueries,
  storedRows,
} from '../support/fakeDatabase.js';

const SAMPLE_ONE = '5b1f7c3a-2d4e-4f6a-8b9c-0d1e2f3a4b5c';
const SAMPLE_TWO = '6c2a8d4b-3e5f-4a7b-9c0d-1e2f3a4b5c6d';
const SOMEONE_ELSE = '7d3b9e5c-4f6a-4b8c-8d1e-2f3a4b5c6d7e';
const TODAY = '2026-10-06';

const samples = () => [
  { userId: SAMPLE_ONE, transactions: generateSampleTransactions(0, TODAY) },
  { userId: SAMPLE_TWO, transactions: generateSampleTransactions(1, TODAY) },
];

// The stored rows without the values the database generates, for comparing runs.
function contents() {
  return storedRows()
    .map(({ user_id, amount_cents, date, type, category, description }) =>
      JSON.stringify({ user_id, amount_cents, date, type, category, description })
    )
    .sort();
}

const OTHER_USERS_ROW = { user_id: SOMEONE_ELSE, amount_cents: 999, date: '2026-10-01', type: 'expense', category: 'Food', description: 'Not sample data' };

describe('replaceSampleTransactions', () => {
  it('stores every sample transaction for the right user', async () => {
    const input = samples();

    const result = await replaceSampleTransactions(pool, input);

    const inserted = input[0].transactions.length + input[1].transactions.length;
    expect(result).toEqual({ removed: 0, inserted });
    const rows = storedRows();
    expect(rows.filter((row) => row.user_id === SAMPLE_ONE)).toHaveLength(input[0].transactions.length);
    expect(rows.filter((row) => row.user_id === SAMPLE_TWO)).toHaveLength(input[1].transactions.length);
    expect(rows).toContainEqual(expect.objectContaining({ user_id: SAMPLE_ONE, ...input[0].transactions[0] }));
  });

  it('gives the same result when run twice', async () => {
    await replaceSampleTransactions(pool, samples());
    const afterFirstRun = contents();

    const result = await replaceSampleTransactions(pool, samples());

    expect(contents()).toEqual(afterFirstRun);
    expect(result.removed).toBe(result.inserted);
  });

  it('replaces the sample users’ old transactions and leaves everyone else’s alone', async () => {
    const [othersRow] = addRows(OTHER_USERS_ROW);
    addRows({ ...OTHER_USERS_ROW, user_id: SAMPLE_ONE, description: 'Old sample row' });

    const result = await replaceSampleTransactions(pool, samples());

    expect(result.removed).toBe(1);
    const rows = storedRows();
    expect(rows).toContainEqual(othersRow);
    expect(rows.some((row) => row.description === 'Old sample row')).toBe(false);
  });

  it('writes in one transaction, using parameters for every value', async () => {
    await replaceSampleTransactions(pool, samples());

    const statements = recordedQueries().map(({ sql }) => sql.split(' ')[0]);
    expect(statements).toEqual(['BEGIN', 'DELETE', 'INSERT', 'COMMIT']);
    for (const { sql } of recordedQueries()) {
      expect(sql).not.toMatch(/'|\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it('leaves the table exactly as it was if the insert fails, and releases the connection', async () => {
    addRows(OTHER_USERS_ROW, { ...OTHER_USERS_ROW, user_id: SAMPLE_ONE, description: 'Old sample row' });
    const before = storedRows();
    const failure = new Error('connection lost');
    failNextQuery(failure, /^INSERT/);

    await expect(replaceSampleTransactions(pool, samples())).rejects.toBe(failure);

    expect(storedRows()).toEqual(before);
    expect(recordedQueries().at(-1).sql).toBe('ROLLBACK');
    expect(openClientCount()).toBe(0);
  });

  it('rejects an invalid sample transaction before writing anything', async () => {
    const input = samples();
    input[1].transactions[3] = { ...input[1].transactions[3], amount_cents: 0 };

    const error = await replaceSampleTransactions(pool, input).catch((err) => err);

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toMatch(/amount_cents must be greater than zero/);
    expect(recordedQueries()).toEqual([]);
    expect(openClientCount()).toBe(0);
  });

  it('refuses to run with no sample transactions', async () => {
    await expect(replaceSampleTransactions(pool, [{ userId: SAMPLE_ONE, transactions: [] }])).rejects.toBeInstanceOf(
      SeedError
    );
    expect(recordedQueries()).toEqual([]);
  });
});
