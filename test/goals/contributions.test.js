// POST /api/goals/:id/contributions (US-49) through the real Express app, with the
// in-memory database and token check from test/setup.js. Invalid amounts and ids for
// this route are also in test/validation/invalidInput.test.js.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import { SAVED_TOTAL_LIMIT } from '../../src/routes/goals.js';
import { ALICE, BOB, bearer } from '../support/fakeAuth.js';
import { addRowsTo, failNextQuery, recordedQueries, storedRowsIn } from '../support/fakeDatabase.js';
import { expectEveryStatementOwnedBy } from '../support/ownership.js';

const app = createApp();

const NOT_FOUND = { error: 'Goal not found.' };
const TRIP = { name: 'Trip to Japan', target_cents: 350000, target_date: '2027-04-01' };

const goal = (id) => storedRowsIn('goals').find((row) => String(row.id) === String(id));

function addGoal(user, changes = {}) {
  const [row] = addRowsTo('goals', { user_id: user.id, ...TRIP, ...changes });
  return row;
}

const contribute = (user, id, body) =>
  request(app).post(`/api/goals/${id}/contributions`).set('Authorization', bearer(user)).send(body);

describe('authentication', () => {
  it('returns 401 without a token, and changes nothing', async () => {
    const trip = addGoal(ALICE);

    const response = await request(app).post(`/api/goals/${trip.id}/contributions`).send({ amount_cents: 2500 });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(recordedQueries()).toEqual([]);
    expect(goal(trip.id).saved_cents).toBe(0);
  });

  it('returns 401 with an invalid token, and changes nothing', async () => {
    const trip = addGoal(ALICE);

    const response = await request(app)
      .post(`/api/goals/${trip.id}/contributions`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ amount_cents: 2500 });

    expect(response.status).toBe(401);
    expect(recordedQueries()).toEqual([]);
  });
});

describe('adding to a goal', () => {
  it('adds the amount to saved_cents and returns the whole goal', async () => {
    const trip = addGoal(ALICE);

    const response = await contribute(ALICE, trip.id, { amount_cents: 2500 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      goal: {
        id: trip.id,
        user_id: ALICE.id,
        name: 'Trip to Japan',
        target_cents: 350000,
        saved_cents: 2500,
        target_date: '2027-04-01',
        created_at: trip.created_at,
        updated_at: expect.any(String),
      },
    });
    expect(response.body.goal.updated_at).not.toBe(trip.updated_at);
    expect(goal(trip.id).saved_cents).toBe(2500);
  });

  it('adds up every contribution exactly, and the goal list shows the total', async () => {
    const trip = addGoal(ALICE);

    for (const amount_cents of [1, 2499, 10000, 37]) {
      expect((await contribute(ALICE, trip.id, { amount_cents })).status).toBe(200);
    }

    const list = await request(app).get('/api/goals').set('Authorization', bearer(ALICE));
    expect(list.body.goals).toEqual([expect.objectContaining({ id: trip.id, saved_cents: 12537, target_cents: 350000 })]);
  });

  it('adds onto what was already saved', async () => {
    const trip = addGoal(ALICE, { saved_cents: 100000 });

    const response = await contribute(ALICE, trip.id, { amount_cents: 50 });

    expect(response.body.goal.saved_cents).toBe(100050);
  });

  it('can take the total past the target, which the progress shows as over 100%', async () => {
    const trip = addGoal(ALICE, { target_cents: 1000, saved_cents: 900 });

    const response = await contribute(ALICE, trip.id, { amount_cents: 500 });

    expect(response.status).toBe(200);
    expect(response.body.goal).toMatchObject({ saved_cents: 1400, target_cents: 1000 });
  });

  it.each([
    ['1 cent', 1],
    ['the largest amount', MAX_AMOUNT_CENTS],
  ])('accepts %s', async (_, amount_cents) => {
    const trip = addGoal(ALICE);

    const response = await contribute(ALICE, trip.id, { amount_cents });

    expect(response.status).toBe(200);
    expect(response.body.goal.saved_cents).toBe(amount_cents);
  });

  it('changes only that goal', async () => {
    const trip = addGoal(ALICE);
    const fund = addGoal(ALICE, { name: 'Emergency fund', saved_cents: 700 });
    const bobs = addGoal(BOB, { saved_cents: 300 });

    await contribute(ALICE, trip.id, { amount_cents: 2500 });

    expect(goal(fund.id).saved_cents).toBe(700);
    expect(goal(bobs.id).saved_cents).toBe(300);
  });

  it('reads only amount_cents: id, user_id, saved_cents and the goal fields in the body are ignored', async () => {
    const trip = addGoal(ALICE, { saved_cents: 100 });

    const response = await contribute(ALICE, trip.id, {
      amount_cents: 25,
      id: 999,
      user_id: BOB.id,
      saved_cents: 9_999_999,
      target_cents: 1,
      name: 'changed',
    });

    expect(response.body.goal).toMatchObject({ id: trip.id, user_id: ALICE.id, saved_cents: 125, target_cents: 350000, name: 'Trip to Japan' });
  });
});

describe('the saved total limit', () => {
  it('accepts a contribution that reaches Number.MAX_SAFE_INTEGER exactly', async () => {
    const trip = addGoal(ALICE, { saved_cents: Number.MAX_SAFE_INTEGER - 10 });

    const response = await contribute(ALICE, trip.id, { amount_cents: 10 });

    expect(response.status).toBe(200);
    expect(response.body.goal.saved_cents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns 400 for one that would pass it, and changes nothing', async () => {
    const trip = addGoal(ALICE, { saved_cents: Number.MAX_SAFE_INTEGER - 10 });

    const response = await contribute(ALICE, trip.id, { amount_cents: 11 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { amount_cents: SAVED_TOTAL_LIMIT } });
    expect(goal(trip.id).saved_cents).toBe(Number.MAX_SAFE_INTEGER - 10);
  });
});

describe('owner-only access', () => {
  it('returns 404 for a goal that does not exist', async () => {
    const response = await contribute(ALICE, 987654, { amount_cents: 2500 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND);
  });

  it('returns the same 404 for another user’s goal, and leaves it unchanged', async () => {
    const bobs = addGoal(BOB, { saved_cents: 300 });
    const before = { ...goal(bobs.id) };

    const response = await contribute(ALICE, bobs.id, { amount_cents: 2500 });
    const missing = await contribute(ALICE, 987654, { amount_cents: 2500 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(missing.body);
    expect(goal(bobs.id)).toEqual(before);
  });

  it('returns 404 once the goal has been deleted', async () => {
    const trip = addGoal(ALICE);
    await request(app).delete(`/api/goals/${trip.id}`).set('Authorization', bearer(ALICE));

    const response = await contribute(ALICE, trip.id, { amount_cents: 2500 });

    expect(response.status).toBe(404);
  });

  it('cannot be pointed at someone else by naming them in the body', async () => {
    const bobs = addGoal(BOB);

    await contribute(ALICE, bobs.id, { amount_cents: 2500, user_id: BOB.id });

    expect(goal(bobs.id).saved_cents).toBe(0);
  });

  it('sends only the logged-in user’s id, as the owner check of every statement', async () => {
    const bobs = addGoal(BOB);
    const trip = addGoal(ALICE);

    await contribute(ALICE, trip.id, { amount_cents: 1 });
    await contribute(ALICE, bobs.id, { amount_cents: 1, user_id: BOB.id });

    expectEveryStatementOwnedBy(recordedQueries(), ALICE.id);
    for (const { params } of recordedQueries()) expect(params).not.toContain(BOB.id);
  });
});

describe('validation', () => {
  it('reports a bad id and a bad amount at once, and never touches the database', async () => {
    const response = await contribute(ALICE, 'abc', { amount_cents: -1 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      errors: { id: 'ID must be a positive whole number.', amount_cents: 'Amount must be greater than 0.' },
    });
    expect(recordedQueries()).toEqual([]);
  });
});

describe('database failures', () => {
  it('returns a clean 500 when the update fails, without its details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const trip = addGoal(ALICE);
    failNextQuery(new Error('connection terminated: secret host details'), /^UPDATE public\.goals/);

    const response = await contribute(ALICE, trip.id, { amount_cents: 2500 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Something went wrong. Please try again later.' });
    expect(goal(trip.id).saved_cents).toBe(0);
  });
});
