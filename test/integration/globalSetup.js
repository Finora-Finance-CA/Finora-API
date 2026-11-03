// Runs once before the integration tests: wipes the local test database, adds the bit
// of Supabase the migrations need (auth.users, with the two test users), then applies
// every migration with the real runner, scripts/migrate.js.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { ALICE_ID, BOB_ID } from './users.js';
import { localTestDatabaseUrl } from '../support/testDatabaseGuard.js';

const run = promisify(execFile);
const MIGRATE = fileURLToPath(new URL('../../scripts/migrate.js', import.meta.url));

export default async function setup() {
  // Checked again here: this function drops schemas.
  const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS auth CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // Supabase's auth.users, cut down to the column the foreign keys use.
    await client.query('CREATE SCHEMA auth');
    await client.query('CREATE TABLE auth.users (id UUID PRIMARY KEY)');
    await client.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [ALICE_ID, BOB_ID]);
  } finally {
    await client.end();
  }

  // DATABASE_URL is given explicitly, so dotenv in src/db.js can't swap in .env's.
  const { stdout } = await run(process.execPath, [MIGRATE], { env: { ...process.env, DATABASE_URL: url } });
  if (!/Migrations complete\./.test(stdout)) {
    throw new Error(`The migrations did not all apply:\n${stdout}`);
  }
}
