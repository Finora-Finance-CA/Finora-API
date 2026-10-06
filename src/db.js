import 'dotenv/config';
import pg from 'pg';

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase connection string.'
  );
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Supabase requires SSL. A local Postgres (e.g. in Docker) usually has it turned off.
function sslConfig(connectionString) {
  const { hostname } = new URL(connectionString);
  return LOCAL_HOSTS.has(hostname) ? false : { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig(DATABASE_URL),
});

// An idle client can lose its connection (e.g. the database restarts). Log it
// instead of letting the unhandled 'error' event crash the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}
