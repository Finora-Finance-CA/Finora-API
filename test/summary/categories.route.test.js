// GET /api/summary/categories (US-43) through the real Express app, with the in-memory
// database and token check from test/setup.js.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRows, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

function categories(user, query) {
  return request(app).get(`/api/summary/categories${query}`).set('Authorization', bearer(user));
}

const expense = (user, date, category, amount_cents) => ({ user_id: user.id, date, type: 'expense', category, amount_cents });
const income = (user, date, category, amount_cents) => ({ user_id: user.id, date, type: 'income', category, amount_cents });

// [category, spent_cents] pairs, which is enough for most checks.
const spent = (response) => response.body.categories.map(({ category, spent_cents }) => [category, spent_cents]);

describe('GET /api/summary/categories', () => {
  it('returns every category with what was spent in it, and the total', async () => {
    addRows(
      // Food: $12.50 + $82.37 = $94.87.
      expense(ALICE, '2026-10-02', 'Food', 1250),
      expense(ALICE, '2026-10-09', 'Food', 8237),
      expense(ALICE, '2026-10-01', 'Housing', 180000),
      expense(ALICE, '2026-10-12', 'Other', 2599)
    );

    const response = await categories(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: '2026-10',
      total_cents: 1250 + 8237 + 180000 + 2599,
      categories: [
        { category: 'Food', spent_cents: 9487 },
        { category: 'Transportation', spent_cents: 0 },
        { category: 'Housing', spent_cents: 180000 },
        { category: 'Entertainment', spent_cents: 0 },
        { category: 'Other', spent_cents: 2599 },
      ],
    });
  });

  it('never counts income, even when it has a category', async () => {
    addRows(expense(ALICE, '2026-10-05', 'Food', 2000), income(ALICE, '2026-10-05', 'Food', 100000));

    const response = await categories(ALICE, '?month=2026-10');

    expect(response.body.total_cents).toBe(2000);
    expect(spent(response)[0]).toEqual(['Food', 2000]);
  });

  it('counts the first and last day of the month, and nothing either side', async () => {
    addRows(
      expense(ALICE, '2026-09-30', 'Food', 1),
      expense(ALICE, '2026-10-01', 'Food', 10),
      expense(ALICE, '2026-10-31', 'Food', 100),
      expense(ALICE, '2026-11-01', 'Food', 1000)
    );

    const response = await categories(ALICE, '?month=2026-10');

    expect(spent(response)[0]).toEqual(['Food', 110]);
  });

  it('returns every category at 0 for a month with no expenses', async () => {
    addRows(expense(ALICE, '2026-09-15', 'Food', 4500));

    const response = await categories(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body.total_cents).toBe(0);
    expect(spent(response).every(([, cents]) => cents === 0)).toBe(true);
  });

  it('never counts another user’s transactions', async () => {
    addRows(expense(ALICE, '2026-10-05', 'Food', 1250), expense(BOB, '2026-10-05', 'Food', 99999));

    const alice = await categories(ALICE, `?month=2026-10&user_id=${BOB.id}`);

    expect(alice.body.total_cents).toBe(1250);
  });

  it('sends only the token’s user id, and the month as a range, as parameters', async () => {
    await categories(ALICE, `?month=2026-12&user_id=${BOB.id}`);

    const [query] = recordedQueries();
    expect(recordedQueries()).toHaveLength(1);
    expect(query.params).toEqual([ALICE.id, 'expense', '2026-12-01', '2027-01-01']);
  });

  it.each([
    ['', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-13', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=1899-12', { month: 'month must be in 1900 or later.' }],
    ['?month=2026-10&month=2026-11', { month: 'month must be given only once.' }],
  ])('returns 400 for %j without querying the database', async (query, errors) => {
    const response = await categories(ALICE, query);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors });
    expect(recordedQueries()).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/summary/categories?month=2026-10');

    expect(response.status).toBe(401);
  });
});
