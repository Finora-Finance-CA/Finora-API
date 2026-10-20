// GET /api/summary (US-27) through the real Express app, with the in-memory database
// and token check from test/setup.js. The month boundaries are checked against the
// fake database, which applies the date conditions exactly as written.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRows, failNextQuery, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

function summary(user, query) {
  return request(app).get(`/api/summary${query}`).set('Authorization', bearer(user));
}

function row(user, date, type, amount_cents) {
  return { user_id: user.id, date, type, amount_cents, category: type === 'expense' ? 'Food' : null };
}

describe('GET /api/summary', () => {
  it('returns the month’s totals in cents', async () => {
    addRows(
      row(ALICE, '2026-10-01', 'income', 245000),
      row(ALICE, '2026-10-02', 'expense', 182500),
      row(ALICE, '2026-10-10', 'expense', 11236),
      row(ALICE, '2026-10-20', 'expense', 6150)
    );

    const response = await summary(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month: '2026-10',
      income_cents: 245000,
      expense_cents: 199886,
      net_cents: 45114,
      transaction_count: 4,
    });
  });

  it('returns zeros for a month with no transactions', async () => {
    addRows(row(ALICE, '2026-09-15', 'income', 1000));

    const response = await summary(ALICE, '?month=2026-10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ month: '2026-10', income_cents: 0, expense_cents: 0, net_cents: 0, transaction_count: 0 });
  });

  it('returns a negative net when more was spent than earned', async () => {
    addRows(row(ALICE, '2026-10-04', 'income', 68540), row(ALICE, '2026-10-05', 'expense', 104238));

    expect((await summary(ALICE, '?month=2026-10')).body.net_cents).toBe(-35698);
  });

  it('includes the first and last day of the month, and nothing either side', async () => {
    addRows(
      row(ALICE, '2026-09-30', 'expense', 1),
      row(ALICE, '2026-10-01', 'expense', 10),
      row(ALICE, '2026-10-31', 'expense', 100),
      row(ALICE, '2026-11-01', 'expense', 1000)
    );

    const response = await summary(ALICE, '?month=2026-10');

    expect(response.body).toMatchObject({ expense_cents: 110, transaction_count: 2 });
  });

  it('keeps December and the next January apart', async () => {
    addRows(
      row(ALICE, '2026-11-30', 'income', 1),
      row(ALICE, '2026-12-01', 'income', 10),
      row(ALICE, '2026-12-31', 'expense', 100),
      row(ALICE, '2027-01-01', 'income', 1000),
      row(ALICE, '2027-01-31', 'expense', 10000),
      row(ALICE, '2027-02-01', 'expense', 100000)
    );

    const december = await summary(ALICE, '?month=2026-12');
    const january = await summary(ALICE, '?month=2027-01');

    expect(december.body).toEqual({
      month: '2026-12',
      income_cents: 10,
      expense_cents: 100,
      net_cents: -90,
      transaction_count: 2,
    });
    expect(january.body).toEqual({
      month: '2027-01',
      income_cents: 1000,
      expense_cents: 10000,
      net_cents: -9000,
      transaction_count: 2,
    });
  });

  it('includes February 29th in a leap year', async () => {
    addRows(row(ALICE, '2028-02-29', 'expense', 500), row(ALICE, '2028-03-01', 'expense', 7));

    expect((await summary(ALICE, '?month=2028-02')).body.expense_cents).toBe(500);
  });

  it('sends the month as a range from the first day up to the first day of the next month', async () => {
    await summary(ALICE, '?month=2026-12');

    const [{ sql, params }] = recordedQueries();
    expect(sql).toMatch(/WHERE user_id = \$1 AND date >= \$2 AND date < \$3/);
    expect(params).toEqual([ALICE.id, '2026-12-01', '2027-01-01']);
  });

  it('counts only the logged-in user’s transactions', async () => {
    addRows(row(ALICE, '2026-10-05', 'expense', 1250), row(BOB, '2026-10-05', 'expense', 99999), row(BOB, '2026-10-06', 'income', 5));

    const response = await summary(ALICE, `?month=2026-10&user_id=${BOB.id}`);

    expect(response.body).toMatchObject({ income_cents: 0, expense_cents: 1250, transaction_count: 1 });
    for (const { params } of recordedQueries()) {
      expect(params).toContain(ALICE.id);
      expect(params).not.toContain(BOB.id);
    }
  });

  it.each([
    ['', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=', { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-13', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-1', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=2026-10-01', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=october', { month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.' }],
    ['?month=1899-12', { month: 'month must be in 1900 or later.' }],
    ['?month=2026-10&month=2026-11', { month: 'month must be given only once.' }],
  ])('returns 400 for %j without querying the database', async (query, errors) => {
    const response = await summary(ALICE, query);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors });
    expect(recordedQueries()).toEqual([]);
  });

  it('returns 401 without a token, and with an invalid one, without querying the database', async () => {
    const noToken = await request(app).get('/api/summary?month=2026-10');
    const badToken = await request(app).get('/api/summary?month=2026-10').set('Authorization', 'Bearer not-a-real-token');

    expect(noToken.status).toBe(401);
    expect(noToken.headers['www-authenticate']).toBe('Bearer');
    expect(badToken.status).toBe(401);
    expect(recordedQueries()).toEqual([]);
  });

  it('returns a clean 500 when the database fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    failNextQuery(new Error('connection to db.internal:5432 failed'));

    const response = await summary(ALICE, '?month=2026-10');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Something went wrong. Please try again later.' });
    expect(response.text).not.toContain('db.internal');
    expect(logged).toHaveBeenCalled();
  });
});
