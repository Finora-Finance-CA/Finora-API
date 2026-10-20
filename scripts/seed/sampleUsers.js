// Gets a sample user's id from Supabase Auth: signs in if the account exists, or
// creates it with normal sign-up the first time. Uses only the publishable key, the
// same way the front-end does, so no secret key is ever needed.

import { SeedError } from './errors.js';

const ALREADY_EXISTS_CODES = new Set(['user_already_exists', 'email_exists']);

/**
 * @param {import('@supabase/supabase-js').SupabaseClient['auth']} auth
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<{ id: string, email: string, created: boolean }>}
 * @throws {SeedError} If the user can't be signed in or created. The message never
 *   includes the password.
 */
export async function signInOrCreateSampleUser(auth, { email, password }) {
  const signIn = await auth.signInWithPassword({ email, password });
  if (!signIn.error) {
    return { id: signIn.data.user.id, email, created: false };
  }
  // Supabase answers "no such user" and "wrong password" the same way, so try signing
  // up and let that tell the two apart.
  if (signIn.error.code !== 'invalid_credentials') {
    throw authFailure(signIn.error, 'sign in', email);
  }

  const signUp = await auth.signUp({ email, password });
  if (signUp.error) {
    throw ALREADY_EXISTS_CODES.has(signUp.error.code) ? wrongPassword(email) : authFailure(signUp.error, 'sign up', email);
  }

  const { user, session } = signUp.data;
  // With email confirmation on, signing up an existing address "succeeds" with a
  // placeholder user that has no identities, so it doesn't reveal who has an account.
  if (!user || user.identities?.length === 0) {
    throw wrongPassword(email);
  }
  if (!session) {
    throw new SeedError(
      `${email} was created but has to confirm their email before signing in. Turn off email confirmation ` +
        'in Supabase (Authentication > Sign In / Providers > Email), or confirm the address, then run the seed again.'
    );
  }
  return { id: user.id, email, created: true };
}

function wrongPassword(email) {
  return new SeedError(
    `${email} already exists, but its password doesn't match the one in .env. ` +
      'Fix the password in .env, or use a different sample email.'
  );
}

function authFailure(error, action, email) {
  if (error.status === 429 || error.code?.startsWith('over_')) {
    return new SeedError(`Supabase is rate limiting ${action} requests. Wait a few minutes, then run the seed again.`);
  }
  if (error.name === 'AuthRetryableFetchError') {
    return new SeedError(`Could not reach Supabase to ${action}. Check SUPABASE_URL and your internet connection.`);
  }
  if (error.code === 'email_not_confirmed') {
    return new SeedError(
      `${email} exists but hasn't confirmed their email, so it can't sign in. ` +
        'Confirm it in the Supabase dashboard, or use a different sample email.'
    );
  }
  return new SeedError(`Supabase rejected ${action} for ${email}: ${error.message}`);
}
