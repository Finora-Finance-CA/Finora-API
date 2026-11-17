// SQL the in-memory database only imitates, run on real Postgres: budget status totals
// (SUM over BIGINT, month boundaries), goals with BIGINT amounts, the constraints the
// routes map to 400s, and row level security on every table.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db.js';
import { GOAL_CONSTRAINTS, SAVED_TOTAL_LIMIT } from '../../src/routes/goals.js';
import { ALICE, bearer } from '../support/fakeAuth.js';

const app = createApp();

const call = (method, path, body) => {
  const req = request(app)[method](path).set('Authorization', bearer(ALICE));
  return body === undefined ? req : req.send(body);
};

const addExpense = (date, category, amount_cents, type = 'expense') =>
  call('post', '/api/transactions', { amount_cents, date, type, category });

describe('GET /api/budgets/status on Postgres', () => {
  it('sums each category’s expenses in the month and nothing else', async () => {
    await call('post', '/api/budgets', { category: 'Food', limit_cents: 50000 });
    await call('post', '/api/budgets', { category: 'Transportation', limit_cents: 15000 });
    await call('post', '/api/budgets', { category: 'Entertainment', limit_cents: 10000 });
    // Food: $12.50 + $82.37 + $310.00 = $404.87, on the first and last day of October.
    await addExpense('2026-10-01', 'Food', 1250);
    await addExpense('2026-10-15', 'Food', 8237);
    await addExpense('2026-10-31', 'Food', 31000);
    // Transportation: $45.00 + $128.15 = $173.15, $23.15 over.
    await addExpense('2026-10-03', 'Transportation', 4500);
    await addExpense('2026-10-20', 'Transportation', 12815);
    // Not counted: the months either side, income with a category, a category with no budget.
    await addExpense('2026-09-30', 'Food', 99999);
    await addExpense('2026-11-01', 'Food', 99999);
    await addExpense('2026-10-10', 'Food', 99999, 'income');
    await addExpense('2026-10-10', 'Other', 777);

    const response = await call('get', '/api/budgets/status?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body.budgets.map(({ id, ...rest }) => rest)).toEqual([
      { category: 'Food', limit_cents: 50000, spent_cents: 40487, remaining_cents: 9513, percent_used: 80, status: 'warning' },
      { category: 'Transportation', limit_cents: 15000, spent_cents: 17315, remaining_cents: -2315, percent_used: 115, status: 'over' },
      { category: 'Entertainment', limit_cents: 10000, spent_cents: 0, remaining_cents: 10000, percent_used: 0, status: 'under' },
    ]);
  });

  it('returns a total beyond what one INTEGER holds, exactly, as a number', async () => {
    await call('post', '/api/budgets', { category: 'Housing', limit_cents: 2_147_483_647 });
    for (let i = 0; i < 3; i += 1) await addExpense('2026-12-05', 'Housing', 2_147_483_647);

    const [housing] = (await call('get', '/api/budgets/status?month=2026-12')).body.budgets;

    expect(housing).toMatchObject({ spent_cents: 6_442_450_941, percent_used: 300, status: 'over' });
  });
});

describe('/api/goals on Postgres', () => {
  it('creates, lists newest first, updates and deletes, with amounts as numbers', async () => {
    const trip = (await call('post', '/api/goals', { name: '  Trip  ', target_cents: 350000, target_date: '2027-04-01' })).body.goal;
    const fund = (await call('post', '/api/goals', { name: 'Emergency fund', target_cents: 500000 })).body.goal;

    expect(trip).toMatchObject({ name: 'Trip', target_cents: 350000, saved_cents: 0, target_date: '2027-04-01' });
    expect(fund).toMatchObject({ target_date: null, saved_cents: 0 });

    const list = (await call('get', '/api/goals')).body.goals;
    expect(list.map((goal) => goal.name)).toEqual(['Emergency fund', 'Trip']);

    const updated = await call('put', `/api/goals/${trip.id}`, { name: 'Trip to Japan', target_cents: 420000 });
    expect(updated.status).toBe(200);
    expect(updated.body.goal).toMatchObject({ name: 'Trip to Japan', target_cents: 420000, target_date: null, saved_cents: 0 });
    expect(new Date(updated.body.goal.updated_at) >= new Date(trip.updated_at)).toBe(true);

    expect((await call('delete', `/api/goals/${trip.id}`)).status).toBe(204);
    expect((await call('get', '/api/goals')).body.goals.map((goal) => goal.id)).toEqual([fund.id]);
  });

  it.each([
    ['nonNegativeSaved', "UPDATE public.goals SET saved_cents = -1"],
    ['positiveTarget', 'UPDATE public.goals SET target_cents = 0'],
    ['nameLength', "UPDATE public.goals SET name = '   '"],
  ])('has the %s constraint the routes expect', async (key, sql) => {
    await call('post', '/api/goals', { name: 'Trip', target_cents: 100 });

    await expect(pool.query(sql)).rejects.toMatchObject({ code: '23514', constraint: GOAL_CONSTRAINTS[key] });
  });
});

describe('POST /api/goals/:id/contributions on Postgres (US-49)', () => {
  const contribute = (id, amount_cents) => call('post', `/api/goals/${id}/contributions`, { amount_cents });

  it('adds each contribution exactly, returns BIGINT totals as numbers, and the list shows them', async () => {
    const trip = (await call('post', '/api/goals', { name: 'Trip', target_cents: 350000 })).body.goal;

    for (const amount of [1, 2499, 2_147_483_647, 2_147_483_647]) expect((await contribute(trip.id, amount)).status).toBe(200);

    const [listed] = (await call('get', '/api/goals')).body.goals;
    expect(listed).toMatchObject({ id: trip.id, saved_cents: 4_294_969_794, target_cents: 350000 });
    expect(typeof listed.saved_cents).toBe('number');
  });

  it('counts every one of several contributions sent at the same time', async () => {
    const trip = (await call('post', '/api/goals', { name: 'Trip', target_cents: 350000 })).body.goal;

    const responses = await Promise.all(Array.from({ length: 10 }, () => contribute(trip.id, 100)));

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
    expect((await call('get', '/api/goals')).body.goals[0].saved_cents).toBe(1000);
  });

  it('stops at Number.MAX_SAFE_INTEGER: reaching it works, passing it is a 400 that changes nothing', async () => {
    const trip = (await call('post', '/api/goals', { name: 'Trip', target_cents: 100 })).body.goal;
    await pool.query('UPDATE public.goals SET saved_cents = $1 WHERE id = $2', [String(Number.MAX_SAFE_INTEGER - 10), trip.id]);

    const over = await contribute(trip.id, 11);
    expect(over.status).toBe(400);
    expect(over.body).toEqual({ errors: { amount_cents: SAVED_TOTAL_LIMIT } });

    const exact = await contribute(trip.id, 10);
    expect(exact.status).toBe(200);
    expect(exact.body.goal.saved_cents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns 404 for a goal that does not exist', async () => {
    expect((await contribute(987654, 100)).status).toBe(404);
  });
});

describe('row level security', () => {
  it('is on for every table in public, so Supabase’s auto-generated API can read none of them', async () => {
    const { rows } = await pool.query(
      `SELECT c.relname AS name, c.relrowsecurity AS rls
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`
    );

    expect(rows.map((row) => row.name)).toEqual(['budgets', 'categories', 'goals', 'schema_migrations', 'transactions']);
    expect(rows.filter((row) => !row.rls)).toEqual([]);
  });
});
