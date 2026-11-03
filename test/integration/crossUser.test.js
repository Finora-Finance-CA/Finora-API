// US-45, US-46 on real Postgres: one user can never read, change or delete another
// user's transactions, budgets or goals. The same checks as test/privacy/crossUser.test.js,
// but here the SQL runs on the real database with the migrations applied.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';

const app = createApp();
const MONTH = '2026-10';

const call = (user, method, path, body) => {
  const req = request(app)[method](path).set('Authorization', bearer(user));
  return body === undefined ? req : req.send(body);
};

const RESOURCES = [
  {
    name: 'transaction',
    table: 'transactions',
    path: '/api/transactions',
    listKey: 'transactions',
    create: { amount_cents: 4200, date: '2026-10-05', type: 'expense', category: 'Food', description: 'Alice’s lunch' },
    update: { amount_cents: 1, date: '2026-10-05', type: 'expense', category: 'Other', description: 'changed by Bob' },
    notFound: 'Transaction not found.',
  },
  {
    name: 'budget',
    table: 'budgets',
    path: '/api/budgets',
    listKey: 'budgets',
    create: { category: 'Food', limit_cents: 50000 },
    update: { limit_cents: 1 },
    notFound: 'Budget not found.',
  },
  {
    name: 'goal',
    table: 'goals',
    path: '/api/goals',
    listKey: 'goals',
    create: { name: 'Alice’s trip', target_cents: 300000, target_date: '2027-06-01' },
    update: { name: 'changed by Bob', target_cents: 1 },
    notFound: 'Goal not found.',
  },
];

let alices;

beforeEach(async () => {
  alices = {};
  for (const resource of RESOURCES) {
    const response = await call(ALICE, 'post', resource.path, resource.create);
    expect(response.status).toBe(201);
    alices[resource.name] = Object.values(response.body)[0];
  }
});

// Read straight from the table, not through the API.
async function storedRow(resource) {
  const { rows } = await pool.query(`SELECT * FROM public.${resource.table} WHERE id = $1`, [alices[resource.name].id]);
  return rows[0];
}

describe.each(RESOURCES)('another user’s $name', (resource) => {
  it('is never in BOB’s list', async () => {
    const response = await call(BOB, 'get', resource.path);

    expect(response.status).toBe(200);
    expect(response.body[resource.listKey]).toEqual([]);
  });

  it('cannot be changed or deleted by BOB, and ALICE reads it back unchanged', async () => {
    const before = await storedRow(resource);
    const id = alices[resource.name].id;

    const put = await call(BOB, 'put', `${resource.path}/${id}`, resource.update);
    const del = await call(BOB, 'delete', `${resource.path}/${id}`);

    expect(put.status).toBe(404);
    expect(put.body).toEqual({ error: resource.notFound });
    expect(del.status).toBe(404);
    expect(await storedRow(resource)).toEqual(before);
    expect((await call(ALICE, 'get', resource.path)).body[resource.listKey]).toContainEqual(alices[resource.name]);
  });

  it('cannot be created for ALICE by BOB naming her in the body', async () => {
    const response = await call(BOB, 'post', resource.path, { ...resource.create, user_id: ALICE.id });

    expect(response.status).toBe(201);
    const { rows } = await pool.query(`SELECT user_id FROM public.${resource.table} WHERE id = $1`, [
      Object.values(response.body)[0].id,
    ]);
    expect(rows[0].user_id).toBe(BOB.id);
  });
});

describe('another user’s spending', () => {
  it('is left out of BOB’s summary and budget status for the same month and category', async () => {
    await call(BOB, 'post', '/api/budgets', { category: 'Food', limit_cents: 10000 });

    const summary = await call(BOB, 'get', `/api/summary?month=${MONTH}`);
    const status = await call(BOB, 'get', `/api/budgets/status?month=${MONTH}`);

    expect(summary.body).toMatchObject({ income_cents: 0, expense_cents: 0, transaction_count: 0 });
    expect(status.body.budgets).toEqual([expect.objectContaining({ category: 'Food', spent_cents: 0, remaining_cents: 10000 })]);
  });

  it('still counts for ALICE', async () => {
    const summary = await call(ALICE, 'get', `/api/summary?month=${MONTH}`);
    const status = await call(ALICE, 'get', `/api/budgets/status?month=${MONTH}`);

    expect(summary.body).toMatchObject({ expense_cents: 4200, transaction_count: 1 });
    expect(status.body.budgets).toEqual([expect.objectContaining({ category: 'Food', spent_cents: 4200 })]);
  });
});
