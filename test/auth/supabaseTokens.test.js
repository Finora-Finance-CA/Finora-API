// US-05: malformed tokens get 401, never 500. These run the real verifySupabaseToken
// and the real Supabase client's getClaims (test/setup.js normally replaces
// verifySupabaseToken with a fake). Nothing reaches the network: the global fetch the
// Supabase client uses is replaced with one that fails, and the tests check that the
// malformed tokens are rejected before it is ever called.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { verifySupabaseToken as fakeVerify } from '../support/fakeAuth.js';
import { recordedQueries } from '../support/fakeDatabase.js';

const { verifySupabaseToken, InvalidTokenError } = await vi.importActual('../../src/auth/supabaseTokens.js');

const app = createApp();

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const IN_AN_HOUR = Math.floor(Date.now() / 1000) + 3600;
const USER_ID = '0f7a3c52-6b1e-4d2a-9c3f-1a2b3c4d5e6f';

// Shapes that look enough like a JWT to get past the Bearer check, but aren't valid.
const MALFORMED_TOKENS = [
  ['three base64url parts that are not JSON', 'abc.def.ghi'],
  ['one part', 'abc'],
  ['two parts', 'abc.def'],
  ['four parts', 'a.b.c.d'],
  ['characters outside base64url', 'abc.d$f.ghi'],
  ['empty parts', '..'],
  ['a header that is JSON null', `${b64('null')}.${b64({ exp: IN_AN_HOUR })}.${b64('sig')}`],
  ['a payload that is not JSON', `${b64({ alg: 'HS256' })}.${b64('not json')}.${b64('sig')}`],
  ['an expired token', `${b64({ alg: 'HS256' })}.${b64({ exp: 1, sub: USER_ID, role: 'authenticated' })}.${b64('sig')}`],
  ['a token without an expiry', `${b64({ alg: 'HS256' })}.${b64({ sub: USER_ID })}.${b64('sig')}`],
];

let networkFetch;

beforeEach(() => {
  // getSupabase() reads these when it first creates the client. Nothing listens here.
  vi.stubEnv('SUPABASE_URL', 'https://finora-test.invalid');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  networkFetch = vi.fn(async () => {
    throw new TypeError('fetch failed: the network is disabled in tests');
  });
  vi.stubGlobal('fetch', networkFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifySupabaseToken with malformed tokens', () => {
  it.each(MALFORMED_TOKENS)('rejects %s with InvalidTokenError, without any network call', async (_, token) => {
    await expect(verifySupabaseToken(token)).rejects.toBeInstanceOf(InvalidTokenError);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('still reports an unreachable Supabase as a server error, not a bad token', async () => {
    // Well formed and unexpired, so Supabase is asked to check it, and the fake fetch fails.
    const token = `${b64({ alg: 'HS256' })}.${b64({ exp: IN_AN_HOUR, sub: USER_ID, role: 'authenticated' })}.${b64('sig')}`;

    const error = await verifySupabaseToken(token).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InvalidTokenError);
    expect(error.message).toMatch(/^Could not reach Supabase to verify token/);
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(String(networkFetch.mock.calls[0][0])).toMatch(/^https:\/\/finora-test\.invalid\//);
  });
});

describe('requireAuth with the real token check', () => {
  beforeEach(() => {
    fakeVerify.mockImplementation(verifySupabaseToken);
  });

  it.each(MALFORMED_TOKENS)('returns 401 for %s', async (_, token) => {
    const response = await request(app).get('/api/transactions').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toEqual({ error: 'Invalid or expired token. Log in again.' });
    expect(recordedQueries()).toEqual([]);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('returns 401 for "Bearer abc.def.ghi" on every endpoint', async () => {
    const auth = ['Authorization', 'Bearer abc.def.ghi'];
    const responses = await Promise.all([
      request(app).get('/api/transactions').set(...auth),
      request(app).post('/api/transactions').set(...auth).send({}),
      request(app).put('/api/transactions/1').set(...auth).send({}),
      request(app).delete('/api/transactions/1').set(...auth),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });

  it('returns a clean 500 when Supabase cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = `${b64({ alg: 'HS256' })}.${b64({ exp: IN_AN_HOUR, sub: USER_ID, role: 'authenticated' })}.${b64('sig')}`;

    const response = await request(app).get('/api/transactions').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Something went wrong. Please try again later.' });
  });
});
