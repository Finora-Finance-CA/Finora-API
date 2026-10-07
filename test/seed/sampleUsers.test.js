// signInOrCreateSampleUser with a fake Supabase `auth` object. The fake answers the
// way Supabase does, so no request ever leaves the test.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedError } from '../../scripts/seed/errors.js';
import { signInOrCreateSampleUser } from '../../scripts/seed/sampleUsers.js';

const CREDENTIALS = Object.freeze({ email: 'sample.one@example.com', password: 'correct-horse-battery' });
const USER_ID = '5b1f7c3a-2d4e-4f6a-8b9c-0d1e2f3a4b5c';

const signedIn = { data: { user: { id: USER_ID }, session: {} }, error: null };
const authError = (fields) => ({ data: { user: null, session: null }, error: { message: 'Auth error', ...fields } });
const INVALID_CREDENTIALS = authError({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' });

let auth;

beforeEach(() => {
  auth = { signInWithPassword: vi.fn(), signUp: vi.fn() };
});

async function failureFor() {
  const error = await signInOrCreateSampleUser(auth, CREDENTIALS).catch((err) => err);
  expect(error).toBeInstanceOf(SeedError);
  expect(error.message).not.toContain(CREDENTIALS.password);
  return error;
}

describe('signInOrCreateSampleUser', () => {
  it('reuses an existing account by signing in, without signing up', async () => {
    auth.signInWithPassword.mockResolvedValue(signedIn);

    await expect(signInOrCreateSampleUser(auth, CREDENTIALS)).resolves.toEqual({
      id: USER_ID,
      email: CREDENTIALS.email,
      created: false,
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith(CREDENTIALS);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('creates the account through sign-up when it does not exist yet', async () => {
    auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
    auth.signUp.mockResolvedValue({
      data: { user: { id: USER_ID, identities: [{ provider: 'email' }] }, session: {} },
      error: null,
    });

    await expect(signInOrCreateSampleUser(auth, CREDENTIALS)).resolves.toEqual({
      id: USER_ID,
      email: CREDENTIALS.email,
      created: true,
    });
    expect(auth.signUp).toHaveBeenCalledWith(CREDENTIALS);
  });

  it.each(['user_already_exists', 'email_exists'])(
    'explains a wrong password when sign-up says the user exists (%s)',
    async (code) => {
      auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
      auth.signUp.mockResolvedValue(authError({ code, status: 422 }));

      const error = await failureFor();

      expect(error.message).toBe(
        "sample.one@example.com already exists, but its password doesn't match the one in .env. " +
          'Fix the password in .env, or use a different sample email.'
      );
    }
  );

  it('explains a wrong password when Supabase hides an existing account behind a placeholder user', async () => {
    auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
    auth.signUp.mockResolvedValue({ data: { user: { id: USER_ID, identities: [] }, session: null }, error: null });

    const error = await failureFor();

    expect(error.message).toMatch(/already exists, but its password doesn't match/);
  });

  it('stops when the new account needs email confirmation before it can be used', async () => {
    auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
    auth.signUp.mockResolvedValue({
      data: { user: { id: USER_ID, identities: [{ provider: 'email' }] }, session: null },
      error: null,
    });

    const error = await failureFor();

    expect(error.message).toMatch(/has to confirm their email/);
  });

  it.each([
    ['sign in', { code: 'over_request_rate_limit', status: 429 }, null],
    ['sign up', null, { code: 'over_email_send_rate_limit', status: 429 }],
    ['sign up', null, { code: 'over_request_rate_limit', status: 400 }],
  ])('explains rate limiting during %s', async (action, signInFields, signUpFields) => {
    auth.signInWithPassword.mockResolvedValue(signInFields ? authError(signInFields) : INVALID_CREDENTIALS);
    if (signUpFields) auth.signUp.mockResolvedValue(authError(signUpFields));

    const error = await failureFor();

    expect(error.message).toBe(`Supabase is rate limiting ${action} requests. Wait a few minutes, then run the seed again.`);
  });

  it.each([
    ['signup_disabled', 'Signups not allowed for this instance'],
    ['email_address_invalid', 'Email address "sample.one@example.com" is invalid'],
    ['weak_password', 'Password should contain at least one character of each kind'],
  ])('reports a rejected sign-up (%s) with Supabase’s reason', async (code, message) => {
    auth.signInWithPassword.mockResolvedValue(INVALID_CREDENTIALS);
    auth.signUp.mockResolvedValue(authError({ code, status: 422, message }));

    const error = await failureFor();

    expect(error.message).toBe(`Supabase rejected sign up for sample.one@example.com: ${message}`);
  });

  it('explains an unconfirmed existing account', async () => {
    auth.signInWithPassword.mockResolvedValue(authError({ code: 'email_not_confirmed', status: 400 }));

    const error = await failureFor();

    expect(error.message).toMatch(/hasn't confirmed their email/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('explains when Supabase cannot be reached', async () => {
    auth.signInWithPassword.mockResolvedValue(
      authError({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' })
    );

    const error = await failureFor();

    expect(error.message).toBe('Could not reach Supabase to sign in. Check SUPABASE_URL and your internet connection.');
  });
});
