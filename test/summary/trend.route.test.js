// GET /api/summary/trend (US-44) through the real Express app, with the in-memory
// database and token check from test/setup.js.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRows, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

function trend(user, query) {
  return request(app).get(`/api/summary/trend${query}`).set('Authorization', bearer(user));
}

const expense = (user, date, amount_cents, category = 'Food') => ({ user_id: user.id, date, type: 'expense', category, amount_cents });
const income = (user, date, amount_cents) => ({ user_id: user.id, date, type: 'income', category: null, amount_cents });

const totals = (response) => response.body.months.map(({ month, expense_cents }) => [month, expense_cents]);

describe('GET /api/summary/trend', () => {
  it('returns total expenses for the 6 months ending at the given one, with 0 for empty months', async () => {
    addRows(
      // July: $12.50 + $82.37 = $94.87, across two categories.
      expense(ALICE, '2026-07-02', 1250),
      expense(ALICE, '2026-07-19', 8237, 'Housing'),
      // November: two expenses on the same day are one row from the database.
      expense(ALICE, '2026-11-01', 50000),
      expense(ALICE, '2026-11-01', 46000, 'Transportation')
    );

    const response = await trend(ALICE, '?month=2026-11');

    expect(response.status).toBe(200);
    expect(response.body.month).toBe('2026-11');
    expect(totals(response)).toEqual([
      ['2026-06', 0],
      ['2026-07', 9487],
      ['2026-08', 0],
      ['2026-09', 0],
      ['2026-10', 0],
      ['2026-11', 96000],
    ]);
  });

  it('never counts income', async () => {
    addRows(expense(ALICE, '2026-11-05', 2000), income(ALICE, '2026-11-05', 100000));

    const response = await trend(ALICE, '?month=2026-11');

    expect(totals(response).at(-1)).toEqual(['2026-11', 2000]);
  });

  it('counts the first day of the first month and the last day of the last, and nothing outside', async () => {
    addRows(
      expense(ALICE, '2026-05-31', 1),
      expense(ALICE, '2026-06-01', 10),
      expense(ALICE, '2026-11-30', 100),
      expense(ALICE, '2026-12-01', 1000)
    );

    const response = await trend(ALICE, '?month=2026-11');

    expect(totals(response)[0]).toEqual(['2026-06', 10]);
    expect(totals(response).at(-1)).toEqual(['2026-11', 100]);
  });

  it('crosses into the previous year', async () => {
    addRows(expense(ALICE, '2026-12-31', 700), expense(ALICE, '2027-01-01', 30));

    const response = await trend(ALICE, '?month=2027-01&months=2');

    expect(totals(response)).toEqual([
      ['2026-12', 700],
      ['2027-01', 30],
    ]);
  });

  it('returns as many months as asked for', async () => {
    const response = await trend(ALICE, '?month=2026-11&months=12');

    expect(response.body.months).toHaveLength(12);
    expect(response.body.months[0].month).toBe('2025-12');
  });

  it('never counts another user’s transactions', async () => {
    addRows(expense(ALICE, '2026-11-05', 1250), expense(BOB, '2026-11-05', 99999));

    const response = await trend(ALICE, `?month=2026-11&user_id=${BOB.id}`);

    expect(totals(response).at(-1)).toEqual(['2026-11', 1250]);
  });

  it('sends one query with only the token’s user id and the whole range as parameters', async () => {
    await trend(ALICE, `?month=2026-11&user_id=${BOB.id}`);

    const queries = recordedQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/WHERE user_id = \$1 AND type = \$2 AND date >= \$3 AND date < \$4 GROUP BY date/);
    expect(queries[0].params).toEqual([ALICE.id, 'expense', '2026-06-01', '2026-12-01']);
  });

  it.each([
    ['', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-13', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-11&months=0', { months: 'months must be a whole number from 1 to 24.' }],
    ['?month=2026-11&months=25', { months: 'months must be a whole number from 1 to 24.' }],
    ['?month=2026-11&months=6&months=12', { months: 'months must be given only once.' }],
  ])('returns 400 for %j without querying the database', async (query, errors) => {
    const response = await trend(ALICE, query);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors });
    expect(recordedQueries()).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    const response = await request(app).get('/api/summary/trend?month=2026-11');

    expect(response.status).toBe(401);
  });
});
