// Reads and checks the seed script's settings before it connects to anything.

import { SeedError } from './errors.js';

// Connection settings the seed needs, the same ones the API uses.
const CONNECTION_VARIABLES = Object.freeze(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']);

// The environment variables holding each sample user's sign-in details, in order.
const SAMPLE_USER_VARIABLES = Object.freeze([
  Object.freeze({ email: 'SEED_USER_1_EMAIL', password: 'SEED_USER_1_PASSWORD' }),
  Object.freeze({ email: 'SEED_USER_2_EMAIL', password: 'SEED_USER_2_PASSWORD' }),
]);

// The shortest password this project's Supabase Auth accepts, also enforced by the
// front-end's register page.
const MIN_PASSWORD_LENGTH = 8;

/**
 * @param {Record<string, string|undefined>} env Usually process.env.
 * @returns {{ users: { email: string, password: string }[] }}
 * @throws {SeedError} In production, or if a variable is missing or invalid. Only the
 *   variable names are ever reported, never their values.
 */
export function readSeedConfig(env) {
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new SeedError('Refusing to run because NODE_ENV is "production". The seed script is for development only.');
  }

  const names = [
    ...CONNECTION_VARIABLES,
    ...SAMPLE_USER_VARIABLES.flatMap(({ email, password }) => [email, password]),
  ];
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new SeedError(`Missing ${missing.join(', ')}. Add them to .env (see .env.example).`);
  }

  const users = SAMPLE_USER_VARIABLES.map(({ email, password }) => ({
    email: env[email].trim().toLowerCase(),
    password: env[password],
  }));

  if (new Set(users.map(({ email }) => email)).size !== users.length) {
    throw new SeedError('Each sample user needs a different email address.');
  }

  const tooShort = SAMPLE_USER_VARIABLES.filter((_, i) => users[i].password.length < MIN_PASSWORD_LENGTH);
  if (tooShort.length > 0) {
    const variables = tooShort.map(({ password }) => password).join(', ');
    throw new SeedError(`${variables} must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return { users };
}
