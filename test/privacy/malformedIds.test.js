// A :id that Express can't decode (e.g. %ZZ) is a client mistake: 400 with the same
// body as any other bad id, never a 500, and nothing reaches the database.

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ALICE, bearer } from '../support/fakeAuth.js';
import { recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

const ID_ROUTES = [
  ['put', '/api/transactions'],
  ['delete', '/api/transactions'],
  ['put', '/api/budgets'],
  ['delete', '/api/budgets'],
  ['put', '/api/goals'],
  ['delete', '/api/goals'],
];

describe.each(ID_ROUTES)('%s %s/:id', (method, path) => {
  it.each(['%ZZ', '%', '%E0%A4%A'])('returns 400 for the undecodable id %s', async (id) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)[method](`${path}/${id}`).set('Authorization', bearer(ALICE)).send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ errors: { id: 'id must be a positive whole number.' } });
    expect(recordedQueries()).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  it('still returns 401 first without a token', async () => {
    const response = await request(app)[method](`${path}/%ZZ`).send({});

    expect(response.status).toBe(401);
  });
});

describe('other errors', () => {
  it('still turns an unexpected URIError into a 500 without its message', async () => {
    const { errorHandler } = await import('../../src/middleware/errorHandler.js');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    errorHandler(new URIError('URI malformed in some/internal/path'), { method: 'GET', originalUrl: '/x' }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Something went wrong. Please try again later.' });
    expect(logged).toHaveBeenCalled();
  });
});
