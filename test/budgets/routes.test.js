// /api/budgets (US-31, US-33) through the real Express app, with the in-memory
// database and token check from test/setup.js.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRowsTo, failNextQuery, recordedQueries, storedRowsIn } from '../support/fakeDatabase.js';

const app = createApp();

const NOT_FOUND = { error: 'Budget not found.' };
const SERVER_ERROR = { error: 'Something went wrong. Please try again later.' };
const CATEGORY_ERROR = 'category must be one of: Food, Transportation, Housing, Entertainment, Other.';
const FOOD = { category: 'Food', limit_cents: 50000 };

const stored = () => storedRowsIn('budgets');

function budgetFor(user, changes = {}) {
  return { user_id: user.id, ...FOOD, ...changes };
}

function addBudgets(...rows) {
  return addRowsTo('budgets', ...rows);
}

function as(user) {
  return {
    list: () => request(app).get('/api/budgets').set('Authorization', bearer(user)),
    create: (body) => request(app).post('/api/budgets').set('Authorization', bearer(user)).send(body),
    update: (id, body) => request(app).put(`/api/budgets/${id}`).set('Authorization', bearer(user)).send(body),
    remove: (id) => request(app).delete(`/api/budgets/${id}`).set('Authorization', bearer(user)),
  };
}

const pgError = (code, constraint) => Object.assign(new Error(`violates "${constraint}"`), { code, constraint });

const ENDPOINTS = [
  ['GET /api/budgets', () => request(app).get('/api/budgets')],
  ['POST /api/budgets', () => request(app).post('/api/budgets').send(FOOD)],
  ['PUT /api/budgets/:id', () => request(app).put('/api/budgets/1').send({ limit_cents: 100 })],
  ['DELETE /api/budgets/:id', () => request(app).delete('/api/budgets/1')],
];

describe('authentication on every budget endpoint', () => {
  describe.each(ENDPOINTS)('%s', (_, send) => {
    it('returns 401 without an Authorization header', async () => {
      const response = await send();

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it('returns 401 with an invalid token, and never touches the database', async () => {
      addBudgets(budgetFor(ALICE));
      const before = stored();

      const response = await send().set('Authorization', 'Bearer not-a-real-token');

      expect(response.status).toBe(401);
      expect(recordedQueries()).toEqual([]);
      expect(stored()).toEqual(before);
    });
  });
});

describe('GET /api/budgets', () => {
  it('returns only the logged-in user’s budgets, in category order', async () => {
    addBudgets(
      budgetFor(ALICE, { category: 'Other', limit_cents: 3000 }),
      budgetFor(BOB, { category: 'Housing', limit_cents: 999999 }),
      budgetFor(ALICE, { category: 'Food', limit_cents: 50000 }),
      budgetFor(ALICE, { category: 'Housing', limit_cents: 180000 })
    );

    const response = await as(ALICE).list();

    expect(response.status).toBe(200);
    expect(response.body.budgets.map((b) => [b.category, b.limit_cents])).toEqual([
      ['Food', 50000],
      ['Housing', 180000],
      ['Other', 3000],
    ]);
    expect(response.body.budgets.every((b) => b.user_id === ALICE.id)).toBe(true);
    expect(Object.keys(response.body.budgets[0]).sort()).toEqual(
      ['category', 'created_at', 'id', 'limit_cents', 'updated_at', 'user_id'].sort()
    );
  });

  it('returns an empty list for a user with no budgets', async () => {
    addBudgets(budgetFor(BOB));

    const response = await as(ALICE).list();

    expect(response.body).toEqual({ budgets: [] });
  });
});

describe('POST /api/budgets', () => {
  it('creates the budget for the logged-in user and returns it', async () => {
    const response = await as(ALICE).create(FOOD);

    expect(response.status).toBe(201);
    expect(response.body.budget).toMatchObject({ ...FOOD, user_id: ALICE.id, id: expect.any(String) });
    expect(stored()).toEqual([expect.objectContaining({ ...FOOD, user_id: ALICE.id })]);
    expect((await as(ALICE).list()).body.budgets).toEqual([response.body.budget]);
  });

  it('takes the owner from the token, never from the body', async () => {
    await as(ALICE).create({ ...FOOD, user_id: BOB.id, id: '777' });

    expect(stored()).toEqual([expect.objectContaining({ user_id: ALICE.id, id: '1' })]);
  });

  it('returns 409 for a second budget in the same category, and keeps the first', async () => {
    const [existing] = addBudgets(budgetFor(ALICE));

    const response = await as(ALICE).create({ category: 'Food', limit_cents: 99 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'You already have a budget for Food. Change that one instead.' });
    expect(stored()).toEqual([existing]);
  });

  it('lets two users each have a budget for the same category', async () => {
    addBudgets(budgetFor(BOB));

    const response = await as(ALICE).create(FOOD);

    expect(response.status).toBe(201);
    expect(stored()).toHaveLength(2);
  });

  it.each([
    ['zero', 0, 'limit_cents must be greater than zero.'],
    ['negative', -100, 'limit_cents must be greater than zero.'],
    ['not whole', 99.5, 'limit_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    ['a string', '50000', 'limit_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    ['too large', MAX_AMOUNT_CENTS + 1, `limit_cents must be at most ${MAX_AMOUNT_CENTS}.`],
    ['missing', undefined, 'limit_cents is required.'],
  ])('returns 400 for a limit that is %s, and saves nothing', async (_, limit_cents, message) => {
    const response = await as(ALICE).create({ category: 'Food', limit_cents });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { limit_cents: message } });
    expect(recordedQueries()).toEqual([]);
  });

  it.each([
    ['unknown', 'Groceries', CATEGORY_ERROR],
    ['in the wrong case', 'food', CATEGORY_ERROR],
    ['missing', undefined, 'category is required.'],
  ])('returns 400 for a category that is %s', async (_, category, message) => {
    const response = await as(ALICE).create({ category, limit_cents: 100 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { category: message } });
    expect(recordedQueries()).toEqual([]);
  });

  it('lists every invalid field at once', async () => {
    const response = await as(ALICE).create({ category: 'Nope', limit_cents: 0 });

    expect(response.body).toEqual({
      errors: { category: CATEGORY_ERROR, limit_cents: 'limit_cents must be greater than zero.' },
    });
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const response = await request(app)
      .post('/api/budgets')
      .set('Authorization', bearer(ALICE))
      .set('Content-Type', 'application/json')
      .send('{"category": "Food",');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { body: 'Request body must be valid JSON.' } });
  });

  it.each([
    ['the categories table rejects the category', pgError('23503', 'budgets_category_fkey'), 400, { errors: { category: CATEGORY_ERROR } }],
    ['the limit CHECK fails', pgError('23514', 'budgets_limit_cents_positive'), 400, { errors: { limit_cents: 'limit_cents must be greater than zero.' } }],
    ['the user no longer exists', pgError('23503', 'budgets_user_id_fkey'), 401, { error: 'User account no longer exists. Log in again.' }],
  ])('returns %i-style errors, not 500, when %s', async (_, error, status, body) => {
    failNextQuery(error);

    const response = await as(ALICE).create(FOOD);

    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
  });
});

describe('PUT /api/budgets/:id', () => {
  it('changes the limit of the owner’s budget and returns it', async () => {
    const [budget] = addBudgets(budgetFor(ALICE));

    const response = await as(ALICE).update(budget.id, { limit_cents: 65000 });

    expect(response.status).toBe(200);
    expect(response.body.budget).toMatchObject({ id: budget.id, category: 'Food', limit_cents: 65000, user_id: ALICE.id });
    expect(response.body.budget.updated_at).not.toBe(budget.updated_at);
  });

  it('never changes the category, the owner or the id', async () => {
    const [budget] = addBudgets(budgetFor(ALICE));

    await as(ALICE).update(budget.id, { limit_cents: 100, category: 'Housing', user_id: BOB.id, id: '99' });

    expect(stored()).toEqual([expect.objectContaining({ id: budget.id, category: 'Food', user_id: ALICE.id, limit_cents: 100 })]);
  });

  it('returns 404 for a budget that does not exist', async () => {
    const response = await as(ALICE).update('12345', { limit_cents: 100 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 for another user’s budget and leaves it unchanged', async () => {
    const [bobs] = addBudgets(budgetFor(BOB));

    const response = await as(ALICE).update(bobs.id, { limit_cents: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
    expect(stored()).toEqual([bobs]);
  });

  it.each([
    [0, 'limit_cents must be greater than zero.'],
    [-5, 'limit_cents must be greater than zero.'],
    [1.25, 'limit_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    [MAX_AMOUNT_CENTS + 1, `limit_cents must be at most ${MAX_AMOUNT_CENTS}.`],
    [undefined, 'limit_cents is required.'],
  ])('returns 400 for the limit %j, and changes nothing', async (limit_cents, message) => {
    const [budget] = addBudgets(budgetFor(ALICE));

    const response = await as(ALICE).update(budget.id, { limit_cents });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { limit_cents: message } });
    expect(stored()).toEqual([budget]);
  });

  it('reports a bad id together with an invalid limit', async () => {
    const response = await as(ALICE).update('abc', { limit_cents: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: { id: 'id must be a positive whole number.', limit_cents: 'limit_cents must be greater than zero.' },
    });
  });

  it.each(['abc', '1.5', '0', '-3', '01', '9223372036854775808'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).update(id, { limit_cents: 100 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('DELETE /api/budgets/:id', () => {
  it('deletes the owner’s budget and returns 204 with no body', async () => {
    const [food, housing] = addBudgets(budgetFor(ALICE), budgetFor(ALICE, { category: 'Housing' }));

    const response = await as(ALICE).remove(food.id);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(stored()).toEqual([housing]);
  });

  it('returns 404 when deleting the same budget twice', async () => {
    const [budget] = addBudgets(budgetFor(ALICE));
    await as(ALICE).remove(budget.id);

    const response = await as(ALICE).remove(budget.id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 for another user’s budget and keeps it', async () => {
    const [bobs] = addBudgets(budgetFor(BOB));

    const response = await as(ALICE).remove(bobs.id);

    expect(response.status).toBe(404);
    expect(stored()).toEqual([bobs]);
  });

  it('lets the category be budgeted again after its budget is deleted', async () => {
    const [budget] = addBudgets(budgetFor(ALICE));
    await as(ALICE).remove(budget.id);

    expect((await as(ALICE).create(FOOD)).status).toBe(201);
  });

  it.each(['abc', '0', '1.5'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).remove(id);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('ownership in every budget query', () => {
  it('sends the token’s user id with every statement, even when the body names someone else', async () => {
    const [budget] = addBudgets(budgetFor(ALICE, { category: 'Other' }));

    await as(ALICE).list();
    await as(ALICE).create({ ...FOOD, user_id: BOB.id });
    await as(ALICE).update(budget.id, { limit_cents: 5, user_id: BOB.id });
    await as(ALICE).remove(budget.id);

    const queries = recordedQueries();
    expect(queries).toHaveLength(4);
    for (const { sql, params } of queries) {
      expect(sql).toMatch(/user_id/);
      expect(params).toContain(ALICE.id);
      expect(params).not.toContain(BOB.id);
    }
  });
});

describe('database failures', () => {
  it.each([
    ['GET', () => as(ALICE).list()],
    ['POST', () => as(ALICE).create(FOOD)],
    ['PUT', () => as(ALICE).update('1', { limit_cents: 100 })],
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
