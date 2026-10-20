import { getSupabase } from './supabase.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTokenError extends Error {
  constructor(message = 'Invalid or expired token. Log in again.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

// Supabase's name for "the auth server couldn't be reached or answered with a 5xx".
const UNREACHABLE_ERROR = 'AuthRetryableFetchError';

function unreachable(error) {
  return new Error(`Could not reach Supabase to verify token: ${error.message}`, { cause: error });
}

/**
 * @param {string} token The raw JWT (without "Bearer ").
 * @returns {Promise<{ userId: string }>}
 * @throws {InvalidTokenError} If the token is invalid, expired, malformed or not a user token.
 * @throws {Error} If Supabase can't be reached (a server problem, not the client's).
 */
export async function verifySupabaseToken(token) {
  // Outside the try: missing configuration is a server problem, not a bad token.
  const { auth } = getSupabase();

  let result;
  try {
    result = await auth.getClaims(token);
  } catch (err) {
    // getClaims returns most failures in `error`, but throws on some malformed tokens
    // (e.g. "abc.def.ghi" isn't valid UTF-8 JSON once decoded). That's still a bad
    // token from the client, so it's a 401. Only an unreachable Supabase is ours.
    if (err?.name === UNREACHABLE_ERROR) throw unreachable(err);
    throw new InvalidTokenError();
  }

  const { data, error } = result;
  if (error) {
    if (error.name === UNREACHABLE_ERROR) throw unreachable(error);
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