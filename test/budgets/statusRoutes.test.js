// GET /api/budgets/status (US-35) through the real Express app, with the in-memory
// database and token check from test/setup.js. The 401 and database failure cases are
// in routes.test.js with the other budget endpoints.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRows, addRowsTo, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

function status(user, query) {
  return request(app).get(`/api/budgets/status${query}`).set('Authorization', bearer(user));
}

const budget = (user, category, limit_cents) => ({ user_id: user.id, category, limit_cents });
const expense = (user, date, category, amount_cents) => ({ user_id: user.id, date, type: 'expense', category, amount_cents });
const income = (user, date, category, amount_cents) => ({ user_id: user.id, date, type: 'income', category, amount_cents });

// [category, spent_cents] for each budget in a response, which is enough for most checks.
const spentByBudget = (response) => response.body.budgets.map((item) => [item.category, item.spent_cents]);

describe('GET /api/budgets/status', () => {
  it('returns spent, remaining and percent used for each budget, in category order', async () => {
    const [entertainment, housing, food, transportation] = addRowsTo(
      'budgets',
      budget(ALICE, 'Entertainment', 10000),
      budget(ALICE, 'Housing', 180000),
      budget(ALICE, 'Food', 50000),
      budget(ALICE, 'Transportation', 15000)
    );
    addRows(
      // Food: $12.50 + $82.37 + $310.00 = $404.87 of $500.00, 80.97%.
      expense(ALICE, '2026-10-02', 'Food', 1250),
      expense(ALICE, '2026-10-09', 'Food', 8237),
      expense(ALICE, '2026-10-23', 'Food', 31000),
      // Transportation: $45.00 + $128.15 = $173.15 of $150.00, $23.15 over.
      expense(ALICE, '2026-10-03', 'Transportation', 4500),
      expense(ALICE, '2026-10-15', 'Transportation', 12815),
      // Housing: rent $1,800.00 of $1,800.00, exactly 100%.
      expense(ALICE, '2026-10-01', 'Housing', 180000),
      // No budget for Other, so it isn't listed.
      expense(ALICE, '2026-10-12', 'Other', 2599)
    );

    const response = await status(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: '2026-10',
      budgets: [
        { id: food.id, category: 'Food', limit_cents: 50000, spent_cents: 40487, remaining_cents: 9513, percent_used: 80, status: 'warning' },
        { id: transportation.id, category: 'Transportation', limit_cents: 15000, spent_cents: 17315, remaining_cents: -2315, percent_used: 115, status: 'over' },
        { id: housing.id, category: 'Housing', limit_cents: 180000, spent_cents: 180000, remaining_cents: 0, percent_used: 100, status: 'warning' },
        { id: entertainment.id, category: 'Entertainment', limit_cents: 10000, spent_cents: 0, remaining_cents: 10000, percent_used: 0, status: 'under' },
      ],
    });
    expect(typeof response.body.budgets[0].id).toBe('string');
  });

  it('never counts income, even when it has a category', async () => {
    addRowsTo('budgets', budget(ALICE, 'Food', 50000));
    addRows(expense(ALICE, '2026-10-05', 'Food', 2000), income(ALICE, '2026-10-05', 'Food', 100000));

    const response = await status(ALICE, '?month=2026-10');

    expect(response.body.budgets[0]).toMatchObject({ spent_cents: 2000, remaining_cents: 48000, percent_used: 4, status: 'under' });
  });

  it('counts the first and last day of the month, and nothing either side', async () => {
    addRowsTo('budgets', budget(ALICE, 'Food', 50000));
    addRows(
      expense(ALICE, '2026-09-30', 'Food', 1),
      expense(ALICE, '2026-10-01', 'Food', 10),
      expense(ALICE, '2026-10-31', 'Food', 100),
      expense(ALICE, '2026-11-01', 'Food', 1000)
    );

    const response = await status(ALICE, '?month=2026-10');

    expect(spentByBudget(response)).toEqual([['Food', 110]]);
  });

  it('keeps December and the next January apart', async () => {
    addRowsTo('budgets', budget(ALICE, 'Food', 50000));
    addRows(expense(ALICE, '2026-12-31', 'Food', 700), expense(ALICE, '2027-01-01', 'Food', 30));

    const december = await status(ALICE, '?month=2026-12');
    const january = await status(ALICE, '?month=2027-01');

    expect(spentByBudget(december)).toEqual([['Food', 700]]);
    expect(spentByBudget(january)).toEqual([['Food', 30]]);
  });

  it('compares a month with no spending against the full limit', async () => {
    addRowsTo('budgets', budget(ALICE, 'Food', 50000));
    addRows(expense(ALICE, '2026-09-15', 'Food', 45000));

    const response = await status(ALICE, '?month=2026-10');

    expect(response.body.budgets[0]).toMatchObject({ spent_cents: 0, remaining_cents: 50000, percent_used: 0, status: 'under' });
  });

  it('never counts or returns another user’s budgets or transactions', async () => {
    addRowsTo('budgets', budget(ALICE, 'Food', 50000), budget(BOB, 'Food', 1000), budget(BOB, 'Housing', 90000));
    addRows(
      expense(ALICE, '2026-10-05', 'Food', 1250),
      expense(BOB, '2026-10-05', 'Food', 99999),
      expense(BOB, '2026-10-06', 'Housing', 5000)
    );

    const alice = await status(ALICE, `?month=2026-10&user_id=${BOB.id}`);
    const bob = await status(BOB, '?month=2026-10');

    expect(spentByBudget(alice)).toEqual([['Food', 1250]]);
    expect(spentByBudget(bob)).toEqual([
      ['Food', 99999],
      ['Housing', 5000],
    ]);
  });

  it('sends only the token’s user id, and the month as a range, as parameters', async () => {
    await status(ALICE, `?month=2026-12&user_id=${BOB.id}`);

    const queries = recordedQueries();
    expect(queries).toHaveLength(2);
    for (const { sql, params } of queries) {
      expect(sql).toMatch(/WHERE user_id = \$1/);
      expect(params[0]).toBe(ALICE.id);
      expect(params).not.toContain(BOB.id);
    }
    const spending = queries.find(({ sql }) => sql.includes('FROM public.transactions'));
    expect(spending.sql).toMatch(/WHERE user_id = \$1 AND type = \$2 AND date >= \$3 AND date < \$4 GROUP BY category/);
    expect(spending.params).toEqual([ALICE.id, 'expense', '2026-12-01', '2027-01-01']);
  });

  it('returns an empty list for a user with no budgets, even with spending', async () => {
    addRowsTo('budgets', budget(BOB, 'Food', 50000));
    addRows(expense(ALICE, '2026-10-05', 'Food', 1250));

    const response = await status(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ month: '2026-10', budgets: [] });
  });

  it.each([
    ['', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-13', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-1', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=october', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=1899-12', { month: 'month must be in 1900 or later.' }],
    ['?month=2026-10&month=2026-11', { month: 'month must be given only once.' }],
  ])('returns 400 for %j without querying the database', async (query, errors) => {
    const response = await status(ALICE, query);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors });
    expect(recordedQueries()).toEqual([]);
  });
});
