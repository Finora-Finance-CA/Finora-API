// US-62 (NFR-06) on real Postgres: with 1,000 transactions for one user among 20,000 in
// the table, the queries behind the transactions page and the dashboard use migration
// 007's indexes (no full scan of the table, and no sort for the list), and every
// endpoint answers well inside its budget.
//
// The SQL checked is what the API actually sends: each test calls the real endpoint and
// records the statements on the way to the database, then asks Postgres to EXPLAIN them.

import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db.js';
import { generatePerfTransactions } from '../../scripts/seed/perfTransactions.js';
import { replacePerfTransactions } from '../../scripts/seed/replacePerfTransactions.js';
import { ALICE, bearer } from '../support/fakeAuth.js';

const app = createApp();
const TODAY = '2026-11-16';
const MONTH = '2026-11';
// Other people with transactions of their own, so ALICE's are 1 row in 20, as in a
// real shared table. Removed again after the tests (their rows go with them).
const OTHER_USERS = Array.from({ length: 19 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);

const get = (path) => request(app).get(path).set('Authorization', bearer(ALICE));

beforeAll(async () => {
  // setup.js empties the tables before each test, so the data is loaded here, once, and
  // each test below reads it without writing. This file runs on its own (no file
  // parallelism in the integration config).
  await pool.query('INSERT INTO auth.users (id) SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING', [OTHER_USERS]);
}, 60_000);

afterAll(async () => {
  await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [OTHER_USERS]);
});

async function loadData() {
  await replacePerfTransactions(pool, ALICE.id, generatePerfTransactions(TODAY));
  await pool.query(
    `INSERT INTO public.transactions (user_id, amount_cents, date, type, category, description)
     SELECT u.id, 100 + (n * 37) % 20000, DATE '2026-11-16' - (n % 365),
            CASE WHEN n % 12 = 0 THEN 'income' ELSE 'expense' END,
            CASE WHEN n % 12 = 0 THEN NULL ELSE (ARRAY['Food','Transportation','Housing','Entertainment','Other'])[1 + n % 5] END,
            'Other person ' || n
     FROM unnest($1::uuid[]) AS u(id), generate_series(1, 1000) AS n`,
    [OTHER_USERS]
  );
  await pool.query('INSERT INTO public.budgets (user_id, category, limit_cents) VALUES ($1, $2, $3), ($1, $4, $5)', [
    ALICE.id,
    'Food',
    60000,
    'Transportation',
    20000,
  ]);
  await pool.query('ANALYZE public.transactions');
  await pool.query('ANALYZE public.budgets');
}

// Every statement the API sends while `send` runs.
async function statementsFor(send) {
  const recorded = [];
  const original = pool.query.bind(pool);
  const spy = vi.spyOn(pool, 'query').mockImplementation((text, params) => {
    if (typeof text === 'string' && /^\s*SELECT/i.test(text)) recorded.push({ text, params });
    return original(text, params);
  });
  const response = await send();
  spy.mockRestore();
  expect(response.status).toBe(200);
  return recorded;
}

async function planOf({ text, params }) {
  const { rows } = await pool.query(`EXPLAIN (FORMAT JSON) ${text}`, params);
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    (node.Plans ?? []).forEach(walk);
  };
  walk(rows[0]['QUERY PLAN'][0].Plan);
  return nodes;
}

const usesIndex = (nodes, name) => nodes.some((node) => node['Index Name'] === name);
const scansTransactionsTable = (nodes) =>
  nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'transactions');

describe('query plans with 20,000 transactions (US-62)', () => {
  it('pages the first pages straight from the index, with no sort, and never scans the table', async () => {
    await loadData();
    for (const path of ['/api/transactions', '/api/transactions?page=2', '/api/transactions?page=50']) {
      const statements = await statementsFor(() => get(path));
      const page = statements.find(({ text }) => /ORDER BY/.test(text));
      const count = statements.find(({ text }) => /COUNT\(\*\)/.test(text));

      const pagePlan = await planOf(page);
      // The pages people open read 20 rows from the index in order. For the very last
      // page, Postgres may instead fetch this user's rows through an index and sort them
      // (well under a millisecond for 1,000), which is cheaper than walking the index.
      if (!path.includes('page=50')) {
        expect(usesIndex(pagePlan, 'transactions_user_list_idx'), path).toBe(true);
        expect(pagePlan.some((node) => node['Node Type'] === 'Sort'), path).toBe(false);
      }
      expect(scansTransactionsTable(pagePlan), path).toBe(false);
      expect(scansTransactionsTable(await planOf(count)), path).toBe(false);
    }
  });

  it.each([
    ['a category', '/api/transactions?category=Food'],
    ['two categories', '/api/transactions?category=Food&category=Transportation'],
    ['a date range', '/api/transactions?from=2026-08-01&to=2026-10-31'],
    ['a search', '/api/transactions?q=groceries'],
    ['search, category and dates', '/api/transactions?q=gro&category=Food&from=2026-08-01'],
  ])('filters by %s without scanning the whole table', async (_, path) => {
    await loadData();
    for (const statement of await statementsFor(() => get(path))) {
      expect(scansTransactionsTable(await planOf(statement)), `${path}: ${statement.text}`).toBe(false);
    }
  });

  it.each([
    ['summary', `/api/summary?month=${MONTH}`],
    ['spending by category', `/api/summary/categories?month=${MONTH}`],
    ['6-month trend', `/api/summary/trend?month=${MONTH}`],
    ['budget status', `/api/budgets/status?month=${MONTH}`],
  ])('totals the %s in SQL from the indexes, never by scanning the table', async (_, path) => {
    await loadData();
    const statements = await statementsFor(() => get(path));

    for (const statement of statements.filter(({ text }) => /FROM public\.transactions/.test(text))) {
      expect(statement.text).toMatch(/SUM\(amount_cents\)/);
      expect(statement.text).toMatch(/GROUP BY/);
      expect(scansTransactionsTable(await planOf(statement)), statement.text).toBe(false);
    }
  });

  it('answers every endpoint the pages call well inside the 2-second budget', async () => {
    await loadData();
    const paths = [
      '/api/transactions',
      '/api/transactions?page=50',
      '/api/transactions?q=coffee&category=Food',
      `/api/summary?month=${MONTH}`,
      `/api/summary/categories?month=${MONTH}`,
      `/api/summary/trend?month=${MONTH}`,
      `/api/budgets/status?month=${MONTH}`,
      '/api/budgets',
      '/api/goals',
    ];
    for (const path of paths) await get(path);

    for (const path of paths) {
      const timings = [];
      for (let i = 0; i < 10; i += 1) {
        const started = performance.now();
        expect((await get(path)).status).toBe(200);
        timings.push(performance.now() - started);
      }
      timings.sort((a, b) => a - b);
      // The median of 10, on a local database: generous enough for a slow CI runner,
      // and still a small part of the 2-second page budget.
      expect(timings[4], path).toBeLessThan(250);
    }
  });

  it('can run migration 007 again: nothing fails and the indexes are the same', async () => {
    const indexes = async () =>
      (
        await pool.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('transactions', 'goals') ORDER BY indexname"
        )
      ).rows.map((row) => row.indexname);
    const before = await indexes();
    const sql = await readFile(new URL('../../db/migrations/007_add_query_indexes.sql', import.meta.url), 'utf8');

    await pool.query(sql);
    await pool.query(sql);

    expect(await indexes()).toEqual(before);
    expect(before).toEqual(
      expect.arrayContaining([
        'transactions_user_list_idx',
        'transactions_user_category_date_idx',
        'transactions_user_type_date_idx',
        'goals_user_created_idx',
      ])
    );
    expect(before).not.toContain('transactions_user_id_date_idx');
    expect(before).not.toContain('goals_user_id_idx');
  });

  it('lists the user’s goals with one query', async () => {
    await loadData();
    const statements = await statementsFor(() => get('/api/goals'));

    expect(statements).toHaveLength(1);
  });
});
