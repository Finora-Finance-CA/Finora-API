// GET /api/transactions with paging, search and filters (US-20, US-22 to US-26),
// through the real Express app with the in-memory database from test/setup.js.

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRows, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

function list(user, query = '') {
  return request(app).get(`/api/transactions${query}`).set('Authorization', bearer(user));
}

function expense(user, changes = {}) {
  return { user_id: user.id, amount_cents: 1000, date: '2026-10-01', type: 'expense', category: 'Food', ...changes };
}

function income(user, changes = {}) {
  return { user_id: user.id, amount_cents: 200000, date: '2026-10-01', type: 'income', category: null, ...changes };
}

const descriptions = (response) => response.body.transactions.map((t) => t.description);

// n of Alice's expenses on consecutive days from 2026-01-01, described "t1" (oldest) to "tn".
function addDays(n) {
  const rows = Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return expense(ALICE, { date, description: `t${i + 1}` });
  });
  return addRows(...rows);
}

describe('paging (US-22)', () => {
  it('returns 20 per page, newest first, with no overlap between pages', async () => {
    addDays(45);

    const first = await list(ALICE);
    const second = await list(ALICE, '?page=2');
    const third = await list(ALICE, '?page=3');

    expect(descriptions(first)).toEqual(Array.from({ length: 20 }, (_, i) => `t${45 - i}`));
    expect(descriptions(second)).toEqual(Array.from({ length: 20 }, (_, i) => `t${25 - i}`));
    expect(descriptions(third)).toEqual(['t5', 't4', 't3', 't2', 't1']);
    expect(third.body.pagination).toEqual({ page: 3, page_size: 20, total_count: 45, total_pages: 3 });
  });

  it('returns exactly one full page when there are exactly 20', async () => {
    addDays(20);

    const response = await list(ALICE);

    expect(response.body.transactions).toHaveLength(20);
    expect(response.body.pagination).toEqual({ page: 1, page_size: 20, total_count: 20, total_pages: 1 });
  });

  it('returns an empty page, with the real totals, past the last page', async () => {
    addDays(3);

    const response = await list(ALICE, '?page=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      transactions: [],
      pagination: { page: 5, page_size: 20, total_count: 3, total_pages: 1 },
    });
  });

  it('keeps rows on the same date in a stable order across pages', async () => {
    addRows(...Array.from({ length: 25 }, (_, i) => expense(ALICE, { date: '2026-10-01', description: `same${i + 1}` })));

    const first = await list(ALICE);
    const second = await list(ALICE, '?page=2');

    const all = [...descriptions(first), ...descriptions(second)];
    expect(all).toEqual(Array.from({ length: 25 }, (_, i) => `same${25 - i}`));
  });
});

describe('search by description (US-23)', () => {
  it('finds descriptions containing the text, ignoring case', async () => {
    addRows(
      expense(ALICE, { description: 'Lunch at work' }),
      expense(ALICE, { description: 'Team LUNCH' }),
      expense(ALICE, { description: 'Groceries' }),
      expense(ALICE, { description: null })
    );

    const response = await list(ALICE, '?q=lunch');

    expect(descriptions(response).sort()).toEqual(['Lunch at work', 'Team LUNCH']);
    expect(response.body.pagination.total_count).toBe(2);
  });

  it('trims the search text', async () => {
    addRows(expense(ALICE, { description: 'Coffee' }), expense(ALICE, { description: 'Tea' }));

    const response = await list(ALICE, `?q=${encodeURIComponent('  coffee  ')}`);

    expect(descriptions(response)).toEqual(['Coffee']);
  });

  it('treats an empty or blank search as no search', async () => {
    addRows(expense(ALICE, { description: 'Coffee' }), expense(ALICE, { description: null }));

    expect((await list(ALICE, '?q=')).body.transactions).toHaveLength(2);
    expect((await list(ALICE, '?q=%20%20')).body.transactions).toHaveLength(2);
  });

  it('matches % and _ literally instead of as wildcards', async () => {
    addRows(
      expense(ALICE, { description: '50% off sale' }),
      expense(ALICE, { description: '50 dollars off' }),
      expense(ALICE, { description: 'file_name' }),
      expense(ALICE, { description: 'filename' })
    );

    expect(descriptions(await list(ALICE, `?q=${encodeURIComponent('50%')}`))).toEqual(['50% off sale']);
    expect(descriptions(await list(ALICE, '?q=file_'))).toEqual(['file_name']);
  });

  it('returns an empty list when nothing matches', async () => {
    addRows(expense(ALICE, { description: 'Coffee' }));

    const response = await list(ALICE, '?q=rent');

    expect(response.status).toBe(200);
    expect(response.body.transactions).toEqual([]);
    expect(response.body.pagination.total_count).toBe(0);
  });

  it('sends the search text only as a parameter, never inside the SQL', async () => {
    const attack = "'; DROP TABLE public.transactions; --";

    await list(ALICE, `?q=${encodeURIComponent(attack)}`);

    for (const { sql, params } of recordedQueries()) {
      expect(sql).not.toContain('DROP');
      expect(params).toContain(`%${attack}%`);
    }
  });
});

describe('category filter (US-24)', () => {
  it('shows only one category', async () => {
    addRows(
      expense(ALICE, { category: 'Food', description: 'food' }),
      expense(ALICE, { category: 'Housing', description: 'rent' }),
      income(ALICE, { description: 'pay' })
    );

    expect(descriptions(await list(ALICE, '?category=Housing'))).toEqual(['rent']);
  });

  it('shows several categories when the parameter is repeated', async () => {
    addRows(
      expense(ALICE, { category: 'Food', description: 'food' }),
      expense(ALICE, { category: 'Housing', description: 'rent' }),
      expense(ALICE, { category: 'Entertainment', description: 'movie' }),
      income(ALICE, { description: 'pay' })
    );

    const response = await list(ALICE, '?category=Food&category=Entertainment');

    expect(descriptions(response).sort()).toEqual(['food', 'movie']);
  });

  it('includes an income that has the chosen category, and leaves out income without one', async () => {
    addRows(income(ALICE, { category: 'Other', description: 'refund' }), income(ALICE, { description: 'pay' }));

    expect(descriptions(await list(ALICE, '?category=Other'))).toEqual(['refund']);
  });

  it('ignores an empty category value', async () => {
    addRows(expense(ALICE), income(ALICE));

    expect((await list(ALICE, '?category=')).body.transactions).toHaveLength(2);
  });
});

describe('date range filter (US-25)', () => {
  const SEPTEMBER_EDGES = [
    expense(ALICE, { date: '2026-08-31', description: 'before' }),
    expense(ALICE, { date: '2026-09-01', description: 'first day' }),
    expense(ALICE, { date: '2026-09-15', description: 'middle' }),
    expense(ALICE, { date: '2026-09-30', description: 'last day' }),
    expense(ALICE, { date: '2026-10-01', description: 'after' }),
  ];

  it('includes both the start and end dates', async () => {
    addRows(...SEPTEMBER_EDGES);

    const response = await list(ALICE, '?from=2026-09-01&to=2026-09-30');

    expect(descriptions(response)).toEqual(['last day', 'middle', 'first day']);
  });

  it('works with only a start date', async () => {
    addRows(...SEPTEMBER_EDGES);

    expect(descriptions(await list(ALICE, '?from=2026-09-30'))).toEqual(['after', 'last day']);
  });

  it('works with only an end date', async () => {
    addRows(...SEPTEMBER_EDGES);

    expect(descriptions(await list(ALICE, '?to=2026-09-01'))).toEqual(['first day', 'before']);
  });

  it('allows a single-day range', async () => {
    addRows(...SEPTEMBER_EDGES);

    expect(descriptions(await list(ALICE, '?from=2026-09-15&to=2026-09-15'))).toEqual(['middle']);
  });
});

describe('search, categories and dates together (US-26)', () => {
  it('applies every filter at once, and pages and counts only the matches', async () => {
    addRows(
      ...Array.from({ length: 23 }, (_, i) =>
        expense(ALICE, { date: `2026-09-${String(i + 1).padStart(2, '0')}`, category: 'Food', description: `Lunch ${i + 1}` })
      ),
      expense(ALICE, { date: '2026-09-10', category: 'Housing', description: 'Lunch money for rent' }),
      expense(ALICE, { date: '2026-09-10', category: 'Food', description: 'Groceries' }),
      expense(ALICE, { date: '2026-10-02', category: 'Food', description: 'Lunch in October' })
    );

    const query = '?q=LUNCH&category=Food&category=Entertainment&from=2026-09-01&to=2026-09-30';
    const first = await list(ALICE, query);
    const second = await list(ALICE, `${query}&page=2`);

    expect(first.body.pagination).toEqual({ page: 1, page_size: 20, total_count: 23, total_pages: 2 });
    expect(descriptions(first)[0]).toBe('Lunch 23');
    expect(descriptions(second)).toEqual(['Lunch 3', 'Lunch 2', 'Lunch 1']);
  });

  it('returns everything again with no parameters (clear all)', async () => {
    addRows(expense(ALICE, { description: 'a' }), income(ALICE, { description: 'b' }));

    const filtered = await list(ALICE, '?q=a&category=Food');
    const cleared = await list(ALICE);

    expect(filtered.body.pagination.total_count).toBe(1);
    expect(cleared.body.pagination.total_count).toBe(2);
  });

  it('ignores query parameters it does not know', async () => {
    addRows(expense(ALICE));

    const response = await list(ALICE, `?user_id=${BOB.id}&sort=asc&limit=1000`);

    expect(response.status).toBe(200);
    expect(response.body.transactions).toHaveLength(1);
  });
});

describe('only the logged-in user’s transactions', () => {
  it('never includes another user’s matching rows in the page or the total', async () => {
    addRows(
      expense(ALICE, { description: 'Lunch', date: '2026-09-05' }),
      expense(BOB, { description: 'Lunch', date: '2026-09-05' }),
      expense(BOB, { description: 'Lunch', date: '2026-09-06' })
    );

    const response = await list(ALICE, '?q=lunch&category=Food&from=2026-09-01&to=2026-09-30');

    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0].user_id).toBe(ALICE.id);
    expect(response.body.pagination.total_count).toBe(1);
  });

  it('scopes both the count and the page query to the token’s user', async () => {
    await list(ALICE, `?q=x&category=Food&from=2026-01-01&to=2026-12-31&page=2&user_id=${BOB.id}`);

    const queries = recordedQueries();
    expect(queries).toHaveLength(2);
    for (const { sql, params } of queries) {
      expect(sql).toMatch(/WHERE user_id = \$1/);
      expect(params[0]).toBe(ALICE.id);
      expect(params).not.toContain(BOB.id);
    }
  });

  it('returns 401 without a token, whatever the filters', async () => {
    addRows(expense(ALICE));

    const response = await request(app).get('/api/transactions?q=a&category=Food&page=1');

    expect(response.status).toBe(401);
    expect(recordedQueries()).toEqual([]);
  });
});

describe('invalid query parameters', () => {
  it.each([
    ['page=0', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=-1', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=1.5', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=abc', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=01', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=100001', { page: 'page must be a whole number from 1 to 100000.' }],
    ['page=1&page=2', { page: 'page must be given only once.' }],
    [`q=${'x'.repeat(256)}`, { q: 'q must be at most 255 characters.' }],
    ['q=a&q=b', { q: 'q must be given only once.' }],
    ['category=Groceries', { category: 'category must be one of: Food, Transportation, Housing, Entertainment, Other.' }],
    ['category=food', { category: 'category must be one of: Food, Transportation, Housing, Entertainment, Other.' }],
    ['category=Food&category=Nope', { category: 'category must be one of: Food, Transportation, Housing, Entertainment, Other.' }],
    ['from=2026/09/01', { from: 'from must be a string in YYYY-MM-DD format.' }],
    ['from=2026-02-30', { from: 'from must be a real calendar date.' }],
    ['to=1899-12-31', { to: 'to must be in 1900 or later.' }],
    ['to=yesterday', { to: 'to must be a string in YYYY-MM-DD format.' }],
    ['from=2026-10-01&to=2026-09-30', { to: 'to must be on or after from.' }],
  ])('returns 400 for ?%s without querying the database', async (query, errors) => {
    const response = await list(ALICE, `?${query}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors });
    expect(recordedQueries()).toEqual([]);
  });

  it('lists every invalid parameter at once', async () => {
    const response = await list(ALICE, '?page=0&category=Nope&from=bad&to=2026-13-01');

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.errors)).toEqual(['page', 'category', 'from', 'to']);
  });
});
