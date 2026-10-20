import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseAllowedOrigins } from '../src/cors.js';
import { ALICE, bearer } from './support/fakeAuth.js';

const LOCAL = 'http://localhost:5173';
const PRODUCTION = 'https://finora.vercel.app';
const OTHER = 'https://evil.example';

describe('parseAllowedOrigins', () => {
  it.each([undefined, '', '   ', ' , '])('allows no origins when CLIENT_ORIGIN is %j', (value) => {
    expect(parseAllowedOrigins(value)).toEqual([]);
  });

  it('reads a comma-separated list, ignoring spaces and empty entries', () => {
    expect(parseAllowedOrigins(` ${LOCAL} ,, ${PRODUCTION} `)).toEqual([LOCAL, PRODUCTION]);
  });

  it('writes each origin the way browsers send it', () => {
    expect(parseAllowedOrigins('HTTPS://Finora.Vercel.App/, https://finora.vercel.app:443')).toEqual([
      PRODUCTION,
      PRODUCTION,
    ]);
  });

  it.each([
    ['*'],
    ['finora.vercel.app'],
    ['ftp://finora.vercel.app'],
    ['https://finora.vercel.app/app'],
    ['https://finora.vercel.app?x=1'],
    ['https://user@finora.vercel.app'],
  ])('refuses %j, naming the entry', (entry) => {
    expect(() => parseAllowedOrigins(`${LOCAL},${entry}`)).toThrow(entry === '*' ? /not "\*"/ : entry);
  });
});

describe('CORS', () => {
  const app = createApp({ allowedOrigins: [LOCAL, PRODUCTION] });

  it.each([LOCAL, PRODUCTION])('lets %s read responses', async (origin) => {
    const response = await request(app).get('/health').set('Origin', origin);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers.vary).toMatch(/Origin/);
  });

  it('gives any other site no CORS headers, so the browser blocks it', async () => {
    const response = await request(app).get('/health').set('Origin', OTHER);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still answers requests with no Origin, like curl and health checks', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight for an authenticated JSON request from an allowed origin', async () => {
    const response = await request(app)
      .options('/api/budgets/7')
      .set('Origin', PRODUCTION)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION);
    expect(response.headers['access-control-allow-methods'].split(',')).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
    expect(response.headers['access-control-allow-headers'].split(',')).toEqual(['Authorization', 'Content-Type']);
    expect(response.headers['access-control-max-age']).toBe('600');
  });

  it('does not answer a preflight from another origin with CORS headers', async () => {
    const response = await request(app)
      .options('/api/budgets/7')
      .set('Origin', OTHER)
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('adds the headers to errors too, so the front-end can read a 401', async () => {
    const response = await request(app).get('/api/summary?month=2026-10').set('Origin', PRODUCTION);

    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION);
  });

  it('adds the headers to successful API responses', async () => {
    const response = await request(app)
      .get('/api/budgets')
      .set('Origin', LOCAL)
      .set('Authorization', bearer(ALICE));

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(LOCAL);
  });

  it('allows no cross-origin calls when no origins are listed', async () => {
    const closed = createApp({ allowedOrigins: [] });
    const response = await request(closed).get('/health').set('Origin', LOCAL);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reads CLIENT_ORIGIN when no list is passed', async () => {
    const previous = process.env.CLIENT_ORIGIN;
    process.env.CLIENT_ORIGIN = PRODUCTION;
    try {
      const response = await request(createApp()).get('/health').set('Origin', PRODUCTION);
      expect(response.headers['access-control-allow-origin']).toBe(PRODUCTION);
    } finally {
      process.env.CLIENT_ORIGIN = previous;
    }
  });
});
