// Every route the app serves, except the ones in PUBLIC_PATHS, needs a valid token
// (US-45). The routes are read from the app itself, so a new router mounted without
// requireAuth fails here, in CI, without anyone having to remember to add a test.

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { recordedQueries } from '../support/fakeDatabase.js';

// Reachable without logging in. Anything added here must never return a user's data.
const PUBLIC_PATHS = Object.freeze(['/health']);

// The routes inside a mounted router, as [METHOD, full path] with :id filled in.
function routesOf({ path, handler }) {
  if (!handler?.stack) return [['GET', path]];
  return handler.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map((method) => [
        method.toUpperCase(),
        `${path}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:id\b/g, '1'),
      ])
    );
}

// Mounting a router with app.use(path, router) is how the app adds routes, and Express 5
// doesn't keep the path afterwards, so record each mount while createApp() runs.
async function loadApp() {
  const mounts = [];
  const original = express.application.use;
  vi.spyOn(express.application, 'use').mockImplementation(function (...args) {
    if (typeof args[0] === 'string') mounts.push({ path: args[0], handler: args[1] });
    return original.apply(this, args);
  });
  const { createApp } = await import('../../src/app.js');
  const app = createApp();
  vi.restoreAllMocks();
  return { app, routes: mounts.flatMap(routesOf) };
}

const { app, routes } = await loadApp();
const privateRoutes = routes.filter(([, path]) => !PUBLIC_PATHS.includes(path));

const send = (method, path) => request(app)[method.toLowerCase()](path).send({});

describe('the route list this test reads from the app', () => {
  it('finds every endpoint, so the checks below cover something', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        ['GET', '/health'],
        ['GET', '/api/transactions'],
        ['POST', '/api/transactions'],
        ['PUT', '/api/transactions/1'],
        ['DELETE', '/api/transactions/1'],
        ['GET', '/api/summary'],
        ['GET', '/api/budgets'],
        ['GET', '/api/budgets/status'],
        ['POST', '/api/budgets'],
        ['PUT', '/api/budgets/1'],
        ['DELETE', '/api/budgets/1'],
        ['GET', '/api/goals'],
        ['POST', '/api/goals'],
        ['PUT', '/api/goals/1'],
        ['DELETE', '/api/goals/1'],
      ])
    );
  });

  it('has no public route other than PUBLIC_PATHS', () => {
    expect(privateRoutes.every(([, path]) => path.startsWith('/api/'))).toBe(true);
  });
});

describe.each(privateRoutes)('%s %s', (method, path) => {
  it.each([
    ['no Authorization header', undefined],
    ['a header that is not a Bearer token', 'Basic dXNlcjpwYXNz'],
    ['an empty Bearer token', 'Bearer '],
    ['a token that is not valid', 'Bearer not-a-real-token'],
  ])('returns 401 with %s, without touching the database', async (_, header) => {
    const req = send(method, path);
    const response = await (header === undefined ? req : req.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(recordedQueries()).toEqual([]);
  });
});
