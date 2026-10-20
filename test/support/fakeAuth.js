// Stand-in for Supabase token verification. Each test user has a fixed token; any
// other token is rejected with the real InvalidTokenError, just like an expired or
// forged Supabase token would be.

import { vi } from 'vitest';

const { InvalidTokenError } = await vi.importActual('../../src/auth/supabaseTokens.js');

export const ALICE = Object.freeze({ id: '0f7a3c52-6b1e-4d2a-9c3f-1a2b3c4d5e6f', token: 'test-token-alice' });
export const BOB = Object.freeze({ id: '8e9d0c1b-2a3f-4e5d-8c7b-6a5f4e3d2c1b', token: 'test-token-bob' });

const USERS_BY_TOKEN = new Map([ALICE, BOB].map((user) => [user.token, user]));

/** The Authorization header value for a test user. */
export function bearer(user) {
  return `Bearer ${user.token}`;
}

export const verifySupabaseToken = vi.fn();

export function resetFakeAuth() {
  verifySupabaseToken.mockReset();
  verifySupabaseToken.mockImplementation(async (token) => {
    const user = USERS_BY_TOKEN.get(token);
    if (!user) throw new InvalidTokenError();
    return { userId: user.id };
  });
}
