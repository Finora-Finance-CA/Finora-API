// Minimal auth added for US-13 so the transaction endpoints can be tested before login exists.
// Ayaan owns auth (US-01 to US-05) and is free to change or replace this file.
//
// Finds or creates a user with the given email and prints a token for them.
// Development only: refuses to run when NODE_ENV is production.
//
// Usage: npm run dev:token -- someone@example.com
// Only the token goes to stdout, so it can be captured:
//   $token = npm run --silent dev:token -- someone@example.com

import 'dotenv/config';

// Users created here can never log in with a password. Real hashes from bcrypt are
// 60 characters starting with "$2", so this value can never match one.
const UNUSABLE_PASSWORD_HASH = '!dev-token-user-no-password';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  fail('dev:token is for development only and will not run when NODE_ENV is production.');
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !EMAIL_PATTERN.test(email)) {
  fail('Usage: npm run dev:token -- someone@example.com');
}

// Imported after the checks above so nothing connects to the database unless they pass.
const { pool, query } = await import('../src/db.js');
const { signToken, DEFAULT_TOKEN_EXPIRY } = await import('../src/auth/tokens.js');

async function findOrCreateUser(userEmail) {
  const findSql = 'SELECT id FROM public.users WHERE lower(email) = lower($1)';

  const existing = await query(findSql, [userEmail]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };

  const inserted = await query(
    `INSERT INTO public.users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [userEmail, UNUSABLE_PASSWORD_HASH]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

  // Another run created the same user between the SELECT and the INSERT.
  const raced = await query(findSql, [userEmail]);
  if (!raced.rows[0]) {
    throw new Error(`Could not find or create a user for ${userEmail}.`);
  }
  return { id: raced.rows[0].id, created: false };
}

try {
  const user = await findOrCreateUser(email);
  const token = signToken(user.id);
  console.error(`${user.created ? 'Created' : 'Found'} user ${email} (id ${user.id}). Token expires in ${DEFAULT_TOKEN_EXPIRY}.`);
  console.log(token);
} catch (err) {
  console.error(`Could not create a dev token: ${err.message || err.code || err}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
