// Checks the fake database itself, for the features the route tests rely on: GROUP BY
// with SUM and COUNT, unique constraints, and more than one table.

import { describe, expect, it } from 'vitest';
import { addRows, addRowsTo, pool, storedRowsIn } from './fakeDatabase.js';

const USER = '0f7a3c52-6b1e-4d2a-9c3f-1a2b3c4d5e6f';

describe('aggregates', () => {
  it('sums and counts per GROUP BY group, as BIGINT strings like pg', async () => {
    addRows(
      { user_id: USER, type: 'income', amount_cents: 1000 },
      { user_id: USER, type: 'expense', amount_cents: 250 },
      { user_id: USER, type: 'expense', amount_cents: 300 }
    );

    const { rows } = await pool.query(
      'SELECT type, SUM(amount_cents) AS total_cents, COUNT(*) AS n FROM public.transactions WHERE user_id = $1 GROUP BY type',
      [USER]
    );

    expect(rows).toEqual([
      { type: 'income', total_cents: '1000', n: '1' },
      { type: 'expense', total_cents: '550', n: '2' },
    ]);
  });

  it('returns no groups when nothing matches a GROUP BY', async () => {
    const { rows } = await pool.query(
      'SELECT type, SUM(amount_cents) AS total_cents FROM public.transactions WHERE user_id = $1 GROUP BY type',
      [USER]
    );

    expect(rows).toEqual([]);
  });

  it('returns one row without GROUP BY, with COUNT 0 and SUM NULL when nothing matches', async () => {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n, SUM(amount_cents) AS total FROM public.transactions WHERE user_id = $1',
      [USER]
    );

    expect(rows).toEqual([{ n: 0, total: null }]);
  });

  it('refuses a plain column that is not in GROUP BY, as Postgres does', async () => {
    await expect(
      pool.query('SELECT type, COUNT(*) AS n FROM public.transactions WHERE user_id = $1', [USER])
    ).rejects.toThrow(/must appear in GROUP BY/);
  });
});

describe('unique constraints', () => {
  it('rejects a duplicate with a pg-shaped 23505 error and adds nothing', async () => {
    addRowsTo('budgets', { user_id: USER, category: 'Food', limit_cents: 100 });

    const error = await pool
      .query('INSERT INTO public.budgets (user_id, category, limit_cents) VALUES ($1, $2, $3)', [USER, 'Food', 200])
      .catch((err) => err);

    expect(error).toMatchObject({ code: '23505', constraint: 'budgets_user_id_category_key' });
    expect(storedRowsIn('budgets')).toHaveLength(1);
  });

  it('rejects an update that would make a duplicate, and changes nothing', async () => {
    const [, housing] = addRowsTo(
      'budgets',
      { user_id: USER, category: 'Food', limit_cents: 100 },
      { user_id: USER, category: 'Housing', limit_cents: 200 }
    );

    await expect(
      pool.query('UPDATE public.budgets SET category = $2 WHERE id = $1', [housing.id, 'Food'])
    ).rejects.toMatchObject({ code: '23505' });
    expect(storedRowsIn('budgets').map((row) => row.category)).toEqual(['Food', 'Housing']);
  });

  it('allows the same category for different users', () => {
    expect(() =>
      addRowsTo(
        'budgets',
        { user_id: USER, category: 'Food', limit_cents: 100 },
        { user_id: '8e9d0c1b-2a3f-4e5d-8c7b-6a5f4e3d2c1b', category: 'Food', limit_cents: 100 }
      )
    ).not.toThrow();
  });
});

describe('tables', () => {
  it('keeps each table and its ids separate', () => {
    const [transaction] = addRows({ user_id: USER });
    const [budget] = addRowsTo('budgets', { user_id: USER, category: 'Food', limit_cents: 1 });

    expect(transaction.id).toBe('1');
    expect(budget.id).toBe('1');
    expect(storedRowsIn('budgets')).toEqual([budget]);
  });

  it('throws for a table it does not know', async () => {
    await expect(pool.query('SELECT id FROM public.nope WHERE id = $1', ['1'])).rejects.toThrow(/unknown table/);
  });

  it('rolls back every table', async () => {
    addRowsTo('budgets', { user_id: USER, category: 'Food', limit_cents: 1 });
    const client = await pool.connect();

    await client.query('BEGIN');
    await client.query('DELETE FROM public.budgets WHERE user_id = $1', [USER]);
    await client.query('ROLLBACK');
    client.release();

    expect(storedRowsIn('budgets')).toHaveLength(1);
  });
});
