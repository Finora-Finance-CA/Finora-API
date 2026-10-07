// /api/transactions through the real Express app, with the in-memory database and
// token check from test/setup.js.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer, verifySupabaseToken } from '../support/fakeAuth.js';
import { addRows, failNextQuery, recordedQueries, storedRows } from '../support/fakeDatabase.js';

const app = createApp();

const EXPENSE = { amount_cents: 1250, date: '2026-10-05', type: 'expense', category: 'Food', description: 'Lunch' };
const NOT_FOUND = { error: 'Transaction not found.' };
const SERVER_ERROR = { error: 'Something went wrong. Please try again later.' };

function rowFor(user, changes = {}) {
  return { user_id: user.id, ...EXPENSE, ...changes };
}

function as(user) {
  return {
    list: () => request(app).get('/api/transactions').set('Authorization', bearer(user)),
    create: (body) => request(app).post('/api/transactions').set('Authorization', bearer(user)).send(body),
    update: (id, body) => request(app).put(`/api/transactions/${id}`).set('Authorization', bearer(user)).send(body),
    remove: (id) => request(app).delete(`/api/transactions/${id}`).set('Authorization', bearer(user)),
  };
}

const ENDPOINTS = [
  ['GET /api/transactions', () => request(app).get('/api/transactions')],
  ['POST /api/transactions', () => request(app).post('/api/transactions').send(EXPENSE)],
  ['PUT /api/transactions/:id', () => request(app).put('/api/transactions/1').send(EXPENSE)],
  ['DELETE /api/transactions/:id', () => request(app).delete('/api/transactions/1')],
];

describe('authentication on every endpoint', () => {
  describe.each(ENDPOINTS)('%s', (_, send) => {
    it('returns 401 without an Authorization header', async () => {
      const response = await send();

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      expect(response.body).toEqual({
        error: 'Authentication required. Send an Authorization: Bearer <token> header.',
      });
    });

    it('returns 401 with a malformed Authorization header', async () => {
      const response = await send().set('Authorization', `Basic ${ALICE.token}`);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Authorization header must be in the format: Bearer <token>.' });
    });

    it('returns 401 with an invalid token', async () => {
      const response = await send().set('Authorization', 'Bearer not-a-real-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Invalid or expired token. Log in again.' });
    });

    it('never touches the database when the token is rejected', async () => {
      addRows(rowFor(ALICE));
      const before = storedRows();

      await send().set('Authorization', 'Bearer not-a-real-token');

      expect(recordedQueries()).toEqual([]);
      expect(storedRows()).toEqual(before);
    });
  });

  it('returns a clean 500 when Supabase cannot be reached to check the token', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    verifySupabaseToken.mockRejectedValue(new Error('fetch failed: getaddrinfo ENOTFOUND project.supabase.co'));

    const response = await as(ALICE).list();

    expect(response.status).toBe(500);
    expect(response.body).toEqual(SERVER_ERROR);
  });
});

describe('GET /api/transactions', () => {
  it('returns only the logged-in user’s transactions, newest date first, then newest created', async () => {
    addRows(
      rowFor(ALICE, { date: '2026-09-01', description: 'oldest' }),
      rowFor(BOB, { date: '2026-10-09', description: 'bob' }),
      rowFor(ALICE, { date: '2026-10-05', description: 'same day, created first' }),
      rowFor(ALICE, { date: '2026-10-05', description: 'same day, created second' }),
      rowFor(ALICE, { date: '2026-10-08', description: 'newest' })
    );

    const response = await as(ALICE).list();

    expect(response.status).toBe(200);
    expect(response.body.transactions.map((t) => t.description)).toEqual([
      'newest',
      'same day, created second',
      'same day, created first',
      'oldest',
    ]);
    expect(response.body.transactions.every((t) => t.user_id === ALICE.id)).toBe(true);
  });

  it('returns at most the 50 most recent transactions', async () => {
    const rows = Array.from({ length: 55 }, (_, day) =>
      rowFor(ALICE, { date: `2026-08-${String((day % 28) + 1).padStart(2, '0')}`, description: `t${day}` })
    );
    addRows(...rows);

    const response = await as(ALICE).list();

    const newestFiftyDates = rows.map((row) => row.date).sort().reverse().slice(0, 50);
    expect(response.body.transactions.map((t) => t.date)).toEqual(newestFiftyDates);
  });

  it('returns an empty list for a user with no transactions', async () => {
    addRows(rowFor(BOB));

    const response = await as(ALICE).list();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ transactions: [] });
  });
});

describe('POST /api/transactions', () => {
  it('creates the transaction for the logged-in user and returns it', async () => {
    const response = await as(ALICE).create(EXPENSE);

    expect(response.status).toBe(201);
    expect(response.body.transaction).toMatchObject({ ...EXPENSE, user_id: ALICE.id });
    expect(response.body.transaction.id).toEqual(expect.any(String));
    expect(storedRows()).toEqual([expect.objectContaining({ ...EXPENSE, user_id: ALICE.id })]);
  });

  it('shows the new transaction in the owner’s list', async () => {
    const { body } = await as(ALICE).create(EXPENSE);

    const response = await as(ALICE).list();

    expect(response.body.transactions).toEqual([body.transaction]);
  });

  it('takes the owner from the token, never from the request body', async () => {
    await as(ALICE).create({ ...EXPENSE, user_id: BOB.id });

    expect(storedRows()).toEqual([expect.objectContaining({ user_id: ALICE.id })]);
    expect((await as(BOB).list()).body.transactions).toEqual([]);
  });

  it('returns 400 listing every invalid field, and saves nothing', async () => {
    const response = await as(ALICE).create({ amount_cents: 0, date: '2026-02-30', type: 'expense' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: {
        amount_cents: 'amount_cents must be greater than zero.',
        date: 'date must be a real calendar date.',
        category: 'category is required for an expense.',
      },
    });
    expect(storedRows()).toEqual([]);
  });

  it('returns 400 when required fields are missing', async () => {
    const response = await as(ALICE).create({ description: 'Only a description' });

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.errors)).toEqual(['amount_cents', 'date', 'type']);
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .set('Authorization', bearer(ALICE))
      .set('Content-Type', 'application/json')
      .send('{"amount_cents": 1250,');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { body: 'Request body must be valid JSON.' } });
  });

  it('returns 401 when the user behind a valid token no longer exists', async () => {
    failNextQuery(Object.assign(new Error('insert violates foreign key'), {
      code: '23503',
      constraint: 'transactions_user_id_fkey',
    }));

    const response = await as(ALICE).create(EXPENSE);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'User account no longer exists. Log in again.' });
  });
});

describe('PUT /api/transactions/:id', () => {
  const CHANGES = { amount_cents: 1800, date: '2026-10-06', type: 'expense', category: 'Entertainment', description: 'Movie' };

  it('updates the owner’s transaction and returns the new values', async () => {
    const [row] = addRows(rowFor(ALICE));

    const response = await as(ALICE).update(row.id, CHANGES);

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({ ...CHANGES, id: row.id, user_id: ALICE.id });
    expect(response.body.transaction.updated_at).not.toBe(row.updated_at);
    expect((await as(ALICE).list()).body.transactions).toEqual([response.body.transaction]);
  });

  it('replaces every field, clearing optional ones that are left out', async () => {
    const [row] = addRows(rowFor(ALICE));

    const response = await as(ALICE).update(row.id, { amount_cents: 300000, date: '2026-10-01', type: 'income' });

    expect(response.status).toBe(200);
    expect(response.body.transaction).toMatchObject({ type: 'income', category: null, description: null });
  });

  it('ignores id and user_id in the body', async () => {
    const [row] = addRows(rowFor(ALICE));

    await as(ALICE).update(row.id, { ...CHANGES, id: '999', user_id: BOB.id });

    expect(storedRows()).toEqual([expect.objectContaining({ id: row.id, user_id: ALICE.id })]);
  });

  it('returns 404 for a transaction that does not exist', async () => {
    const response = await as(ALICE).update('12345', CHANGES);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 for another user’s transaction and leaves it unchanged', async () => {
    const [bobsRow] = addRows(rowFor(BOB));

    const response = await as(ALICE).update(bobsRow.id, CHANGES);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
    expect(storedRows()).toEqual([bobsRow]);
  });

  it('returns 400 listing every invalid field, and changes nothing', async () => {
    const [row] = addRows(rowFor(ALICE));

    const response = await as(ALICE).update(row.id, { amount_cents: -1, date: 'tomorrow', type: 'gift' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: {
        amount_cents: 'amount_cents must be greater than zero.',
        date: 'date must be a string in YYYY-MM-DD format.',
        type: 'type must be one of: income, expense.',
      },
    });
    expect(storedRows()).toEqual([row]);
  });

  it('reports a bad id together with the invalid body fields', async () => {
    const response = await as(ALICE).update('abc', { amount_cents: 12.5, date: '2026-10-06', type: 'income' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: {
        id: 'id must be a positive whole number.',
        amount_cents: 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.',
      },
    });
  });

  it.each(['abc', '1.5', '0', '-3', '01', '9223372036854775808'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).update(id, CHANGES);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('DELETE /api/transactions/:id', () => {
  it('deletes the owner’s transaction and returns 204 with no body', async () => {
    const [row, other] = addRows(rowFor(ALICE), rowFor(ALICE, { description: 'keep me' }));

    const response = await as(ALICE).remove(row.id);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(storedRows()).toEqual([other]);
  });

  it('returns 404 for a transaction that does not exist', async () => {
    const response = await as(ALICE).remove('12345');

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 when deleting the same transaction twice', async () => {
    const [row] = addRows(rowFor(ALICE));
    await as(ALICE).remove(row.id);

    const response = await as(ALICE).remove(row.id);

    expect(response.status).toBe(404);
  });

  it('returns 404 for another user’s transaction and keeps it', async () => {
    const [bobsRow] = addRows(rowFor(BOB));

    const response = await as(ALICE).remove(bobsRow.id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
    expect(storedRows()).toEqual([bobsRow]);
  });

  it.each(['abc', '1.5', '0', '-3', '01', '9223372036854775808'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).remove(id);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('ownership in every query', () => {
  it('sends the token’s user id with every statement, even when the body names someone else', async () => {
    const [row] = addRows(rowFor(ALICE));
    const body = { ...EXPENSE, user_id: BOB.id };

    await as(ALICE).list();
    await as(ALICE).create(body);
    await as(ALICE).update(row.id, body);
    await as(ALICE).remove(row.id);

    const queries = recordedQueries();
    expect(queries).toHaveLength(4);
    for (const { params } of queries) {
      expect(params).toContain(ALICE.id);
      expect(params).not.toContain(BOB.id);
    }
  });
});

describe('database failures', () => {
  it.each([
    ['GET', () => as(ALICE).list()],
    ['POST', () => as(ALICE).create(EXPENSE)],
    ['PUT', () => as(ALICE).update('1', EXPENSE)],
    ['DELETE', () => as(ALICE).remove('1')],
  ])('%s returns a clean 500 without internal details', async (_, send) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    failNextQuery(new Error('connection to db.internal:5432 failed: password authentication failed'));

    const response = await send();

    expect(response.status).toBe(500);
    expect(response.body).toEqual(SERVER_ERROR);
    expect(response.text).not.toMatch(/db\.internal|password|5432/);
    expect(logged).toHaveBeenCalled();
  });
});
