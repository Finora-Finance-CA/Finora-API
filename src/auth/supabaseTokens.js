import { getSupabase } from './supabase.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTokenError extends Error {
  constructor(message = 'Invalid or expired token. Log in again.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * @param {string} token The raw JWT (without "Bearer ").
 * @returns {Promise<{ userId: string }>}
 * @throws {InvalidTokenError} If the token is invalid, expired or not a user token.
 * @throws {Error} If Supabase can't be reached (a server problem, not the client's).
 */
export async function verifySupabaseToken(token) {
  const { data, error } = await getSupabase().auth.getClaims(token);

  if (error) {
    if (error.name === 'AuthRetryableFetchError') {
      throw new Error(`Could not reach Supabase to verify token: ${error.message}`);
    }
    throw new InvalidTokenError();
  }

  const claims = data?.claims;

  if (!claims || claims.role !== 'authenticated') {
    throw new InvalidTokenError('Token does not belong to a signed-in user.');
  }
  if (typeof claims.sub !== 'string' || !UUID_PATTERN.test(claims.sub)) {
    throw new InvalidTokenError('Token subject is not a valid user id.');
  }

  return { userId: claims.sub };
}