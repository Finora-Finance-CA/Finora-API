// /api/goals (US-47) through the real Express app, with the in-memory database and
// token check from test/setup.js.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRowsTo, failNextQuery, recordedQueries, storedRowsIn } from '../support/fakeDatabase.js';

const app = createApp();

const NOT_FOUND = { error: 'Goal not found.' };
const SERVER_ERROR = { error: 'Something went wrong. Please try again later.' };
const TRIP = { name: 'Trip to Japan', target_cents: 350000, target_date: '2027-04-01' };

const stored = () => storedRowsIn('goals');

function goalFor(user, changes = {}) {
  return { user_id: user.id, ...TRIP, ...changes };
}

function addGoals(...rows) {
  return addRowsTo('goals', ...rows);
}

function as(user) {
  return {
    list: () => request(app).get('/api/goals').set('Authorization', bearer(user)),
    create: (body) => request(app).post('/api/goals').set('Authorization', bearer(user)).send(body),
    update: (id, body) => request(app).put(`/api/goals/${id}`).set('Authorization', bearer(user)).send(body),
    remove: (id) => request(app).delete(`/api/goals/${id}`).set('Authorization', bearer(user)),
  };
}

const pgError = (code, constraint) => Object.assign(new Error(`violates "${constraint}"`), { code, constraint });

const ENDPOINTS = [
  ['GET /api/goals', () => request(app).get('/api/goals')],
  ['POST /api/goals', () => request(app).post('/api/goals').send(TRIP)],
  ['PUT /api/goals/:id', () => request(app).put('/api/goals/1').send(TRIP)],
  ['DELETE /api/goals/:id', () => request(app).delete('/api/goals/1')],
];

describe('authentication on every goal endpoint', () => {
  describe.each(ENDPOINTS)('%s', (_, send) => {
    it('returns 401 without an Authorization header', async () => {
      const response = await send();

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it('returns 401 with an invalid token, and never touches the database', async () => {
      addGoals(goalFor(ALICE));
      const before = stored();

      const response = await send().set('Authorization', 'Bearer not-a-real-token');

      expect(response.status).toBe(401);
      expect(recordedQueries()).toEqual([]);
      expect(stored()).toEqual(before);
    });
  });
});

describe('GET /api/goals', () => {
  it('returns only the logged-in user’s goals, newest first', async () => {
    addGoals(
      goalFor(ALICE, { name: 'Emergency fund' }),
      goalFor(BOB, { name: 'Bob’s car' }),
      goalFor(ALICE, { name: 'New laptop', target_date: null })
    );

    const response = await as(ALICE).list();

    expect(response.status).toBe(200);
    expect(response.body.goals.map((goal) => goal.name)).toEqual(['New laptop', 'Emergency fund']);
    expect(response.body.goals.every((goal) => goal.user_id === ALICE.id)).toBe(true);
    expect(Object.keys(response.body.goals[0]).sort()).toEqual(
      ['created_at', 'id', 'name', 'saved_cents', 'target_cents', 'target_date', 'updated_at', 'user_id'].sort()
    );
  });

  it('returns an empty list for a user with no goals', async () => {
    addGoals(goalFor(BOB));

    expect((await as(ALICE).list()).body).toEqual({ goals: [] });
  });
});

describe('POST /api/goals', () => {
  it('creates the goal for the logged-in user, with nothing saved yet', async () => {
    const response = await as(ALICE).create(TRIP);

    expect(response.status).toBe(201);
    expect(response.body.goal).toMatchObject({ ...TRIP, saved_cents: 0, user_id: ALICE.id, id: expect.any(String) });
    expect(stored()).toEqual([expect.objectContaining({ ...TRIP, user_id: ALICE.id, saved_cents: 0 })]);
    expect((await as(ALICE).list()).body.goals).toEqual([response.body.goal]);
  });

  it('saves a goal without a target date, and trims the name', async () => {
    const response = await as(ALICE).create({ name: '  Rainy day  ', target_cents: 100000 });

    expect(response.status).toBe(201);
    expect(response.body.goal).toMatchObject({ name: 'Rainy day', target_date: null });
  });

  it('ignores user_id, id and saved_cents in the body', async () => {
    const response = await as(ALICE).create({ ...TRIP, user_id: BOB.id, id: '777', saved_cents: 350000 });

    expect(response.body.goal).toMatchObject({ user_id: ALICE.id, id: '1', saved_cents: 0 });
    expect(stored()).toEqual([expect.objectContaining({ user_id: ALICE.id, id: '1', saved_cents: 0 })]);
  });

  it.each([
    ['name', { name: '' }, 'name is required.'],
    ['name', { name: 'x'.repeat(61) }, 'name must be at most 60 characters.'],
    ['target_cents', { target_cents: 0 }, 'target_cents must be greater than zero.'],
    ['target_cents', { target_cents: -100 }, 'target_cents must be greater than zero.'],
    ['target_cents', { target_cents: '350000' }, 'target_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    ['target_date', { target_date: '2027-02-30' }, 'target_date must be a real calendar date.'],
  ])('returns 400 for an invalid %s, and saves nothing', async (field, change, message) => {
    const response = await as(ALICE).create({ ...TRIP, ...change });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { [field]: message } });
    expect(recordedQueries()).toEqual([]);
  });

  it('lists every invalid field at once', async () => {
    const response = await as(ALICE).create({ name: '  ', target_cents: 0, target_date: 'soon' });

    expect(response.body).toEqual({
      errors: {
        name: 'name is required.',
        target_cents: 'target_cents must be greater than zero.',
        target_date: 'target_date must be a string in YYYY-MM-DD format.',
      },
    });
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const response = await request(app)
      .post('/api/goals')
      .set('Authorization', bearer(ALICE))
      .set('Content-Type', 'application/json')
      .send('{"name": "Trip",');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { body: 'Request body must be valid JSON.' } });
  });

  it.each([
    ['the target CHECK fails', pgError('23514', 'goals_target_cents_positive'), 400, { errors: { target_cents: 'target_cents must be greater than zero.' } }],
    ['the name CHECK fails', pgError('23514', 'goals_name_length'), 400, { errors: { name: 'name must be 1 to 60 characters.' } }],
    ['the user no longer exists', pgError('23503', 'goals_user_id_fkey'), 401, { error: 'User account no longer exists. Log in again.' }],
  ])('returns a clean %s-style error when %s', async (_, error, status, body) => {
    failNextQuery(error);

    const response = await as(ALICE).create(TRIP);

    expect(response.status).toBe(status);
    expect(response.body).toEqual(body);
  });
});

describe('PUT /api/goals/:id', () => {
  it('replaces the name, target and date of the owner’s goal and returns it', async () => {
    const [goal] = addGoals(goalFor(ALICE));

    const response = await as(ALICE).update(goal.id, { name: 'Trip to Korea', target_cents: 420000, target_date: '2027-09-15' });

    expect(response.status).toBe(200);
    expect(response.body.goal).toMatchObject({
      id: goal.id,
      name: 'Trip to Korea',
      target_cents: 420000,
      target_date: '2027-09-15',
      user_id: ALICE.id,
    });
    expect(response.body.goal.updated_at).not.toBe(goal.updated_at);
  });

  it('clears the target date when it is left out', async () => {
    const [goal] = addGoals(goalFor(ALICE));

    const response = await as(ALICE).update(goal.id, { name: 'Trip', target_cents: 1000 });

    expect(response.body.goal.target_date).toBeNull();
  });

  it('never changes saved_cents, the owner or the id', async () => {
    const [goal] = addGoals(goalFor(ALICE, { saved_cents: 12500 }));

    const response = await as(ALICE).update(goal.id, { ...TRIP, saved_cents: 0, user_id: BOB.id, id: '99' });

    expect(response.body.goal).toMatchObject({ id: goal.id, user_id: ALICE.id, saved_cents: 12500 });
    expect(stored()).toEqual([expect.objectContaining({ id: goal.id, user_id: ALICE.id, saved_cents: 12500 })]);
  });

  it('returns 404 for a goal that does not exist', async () => {
    const response = await as(ALICE).update('12345', TRIP);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 for another user’s goal and leaves it unchanged', async () => {
    const [bobs] = addGoals(goalFor(BOB));

    const response = await as(ALICE).update(bobs.id, { name: 'Mine now', target_cents: 1 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
    expect(stored()).toEqual([bobs]);
  });

  it('returns 400 for invalid fields, and changes nothing', async () => {
    const [goal] = addGoals(goalFor(ALICE));

    const response = await as(ALICE).update(goal.id, { name: '', target_cents: -1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: { name: 'name is required.', target_cents: 'target_cents must be greater than zero.' },
    });
    expect(stored()).toEqual([goal]);
  });

  it('reports a bad id together with invalid fields', async () => {
    const response = await as(ALICE).update('abc', { name: 'Trip', target_cents: 0 });

    expect(response.body).toEqual({
      errors: { id: 'id must be a positive whole number.', target_cents: 'target_cents must be greater than zero.' },
    });
  });

  it.each(['abc', '1.5', '0', '-3', '01', '9223372036854775808'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).update(id, TRIP);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('DELETE /api/goals/:id', () => {
  it('deletes the owner’s goal and returns 204 with no body', async () => {
    const [trip, fund] = addGoals(goalFor(ALICE), goalFor(ALICE, { name: 'Emergency fund' }));

    const response = await as(ALICE).remove(trip.id);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(stored()).toEqual([fund]);
  });

  it('returns 404 when deleting the same goal twice', async () => {
    const [goal] = addGoals(goalFor(ALICE));
    await as(ALICE).remove(goal.id);

    const response = await as(ALICE).remove(goal.id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns 404 for another user’s goal and keeps it', async () => {
    const [bobs] = addGoals(goalFor(BOB));

    const response = await as(ALICE).remove(bobs.id);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
    expect(stored()).toEqual([bobs]);
  });

  it.each(['abc', '0', '1.5'])('returns 400 for the id %s', async (id) => {
    const response = await as(ALICE).remove(id);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('ownership in every goal query', () => {
  it('sends the token’s user id with every statement, even when the body names someone else', async () => {
    const [goal] = addGoals(goalFor(ALICE));

    await as(ALICE).list();
    await as(ALICE).create({ ...TRIP, user_id: BOB.id });
    await as(ALICE).update(goal.id, { ...TRIP, user_id: BOB.id });
    await as(ALICE).remove(goal.id);

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
    ['POST', () => as(ALICE).create(TRIP)],
    ['PUT', () => as(ALICE).update('1', TRIP)],
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
