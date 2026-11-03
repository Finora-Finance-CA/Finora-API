// US-45, US-46: one user can never read, change or delete another user's transactions,
// budgets or goals. ALICE creates one of each through the API; BOB then tries every
// endpoint on them. Runs on the in-memory database from test/setup.js, which applies
// exactly the conditions in the SQL, so a query that lost its owner check would leak
// here. test/integration/crossUser.test.js runs the same checks on real Postgres.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { recordedQueries } from '../support/fakeDatabase.js';
import { expectEveryStatementOwnedBy } from '../support/ownership.js';

const app = createApp();
const MONTH = '2026-10';

const call = (user, method, path, body) => {
  const req = request(app)[method](path).set('Authorization', bearer(user));
  return body === undefined ? req : req.send(body);
};

// One of each of ALICE's records, as she creates them.
const RESOURCES = [
  {
    name: 'transaction',
    path: '/api/transactions',
    listKey: 'transactions',
    create: { amount_cents: 4200, date: '2026-10-05', type: 'expense', category: 'Food', description: 'Alice’s lunch' },
    update: { amount_cents: 1, date: '2026-10-05', type: 'expense', category: 'Other', description: 'changed by Bob' },
    notFound: 'Transaction not found.',
  },
  {
    name: 'budget',
    path: '/api/budgets',
    listKey: 'budgets',
    create: { category: 'Food', limit_cents: 50000 },
    update: { limit_cents: 1 },
    notFound: 'Budget not found.',
  },
  {
    name: 'goal',
    path: '/api/goals',
    listKey: 'goals',
    create: { name: 'Alice’s trip', target_cents: 300000, target_date: '2027-06-01' },
    update: { name: 'changed by Bob', target_cents: 1 },
    notFound: 'Goal not found.',
  },
];

// ALICE's records, by resource name, as the API returned them when she created them.
let alices;

beforeEach(async () => {
  alices = {};
  for (const resource of RESOURCES) {
    const response = await call(ALICE, 'post', resource.path, resource.create);
    expect(response.status).toBe(201);
    alices[resource.name] = Object.values(response.body)[0];
  }
});

// ALICE reads her own list and finds the record exactly as she created it.
async function expectUnchanged(resource) {
  const response = await call(ALICE, 'get', resource.path);
  expect(response.body[resource.listKey]).toContainEqual(alices[resource.name]);
}

describe.each(RESOURCES)('another user’s $name', (resource) => {
  it('is never in BOB’s list', async () => {
    const response = await call(BOB, 'get', resource.path);

    expect(response.status).toBe(200);
    expect(response.body[resource.listKey]).toEqual([]);
  });

  it('cannot be changed: PUT returns 404, the same as an id that does not exist', async () => {
    const response = await call(BOB, 'put', `${resource.path}/${alices[resource.name].id}`, resource.update);
    const missing = await call(BOB, 'put', `${resource.path}/987654`, resource.update);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: resource.notFound });
    expect(missing.body).toEqual(response.body);
    await expectUnchanged(resource);
  });

  it('cannot be deleted: DELETE returns 404, the same as an id that does not exist', async () => {
    const response = await call(BOB, 'delete', `${resource.path}/${alices[resource.name].id}`);
    const missing = await call(BOB, 'delete', `${resource.path}/987654`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: resource.notFound });
    expect(missing.body).toEqual(response.body);
    await expectUnchanged(resource);
  });

  it('cannot be reached by naming ALICE in the body or the query string', async () => {
    const response = await call(BOB, 'post', `${resource.path}?user_id=${ALICE.id}`, { ...resource.create, user_id: ALICE.id });

    expect(response.status).toBe(201);
    expect(Object.values(response.body)[0].user_id).toBe(BOB.id);
    expect((await call(BOB, 'get', resource.path)).body[resource.listKey]).toHaveLength(1);
    await expectUnchanged(resource);
  });

  it('sends only BOB’s id in BOB’s statements, as the owner check of each one', async () => {
    const id = alices[resource.name].id;
    const before = recordedQueries().length;

    await call(BOB, 'get', resource.path);
    await call(BOB, 'put', `${resource.path}/${id}`, resource.update);
    await call(BOB, 'delete', `${resource.path}/${id}`);

    const bobs = recordedQueries().slice(before);
    expectEveryStatementOwnedBy(bobs, BOB.id);
    for (const { params } of bobs) expect(params).not.toContain(ALICE.id);
  });
});

describe('another user’s spending', () => {
  it('is left out of BOB’s monthly summary', async () => {
    const response = await call(BOB, 'get', `/api/summary?month=${MONTH}`);

    expect(response.body).toEqual({ month: MONTH, income_cents: 0, expense_cents: 0, net_cents: 0, transaction_count: 0 });
  });

  it('is left out of BOB’s budget status, even for the same category', async () => {
    await call(BOB, 'post', '/api/budgets', { category: 'Food', limit_cents: 10000 });

    const response = await call(BOB, 'get', `/api/budgets/status?month=${MONTH}`);

    expect(response.body.budgets).toEqual([
      expect.objectContaining({ category: 'Food', limit_cents: 10000, spent_cents: 0, remaining_cents: 10000 }),
    ]);
  });

  it('still counts for ALICE', async () => {
    const summary = await call(ALICE, 'get', `/api/summary?month=${MONTH}`);
    const status = await call(ALICE, 'get', `/api/budgets/status?month=${MONTH}`);

    expect(summary.body.expense_cents).toBe(4200);
    expect(status.body.budgets).toEqual([expect.objectContaining({ category: 'Food', spent_cents: 4200 })]);
  });
});
