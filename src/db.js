import 'dotenv/config';
import pg from 'pg';

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase connection string.'
  );
}

// Return DATE columns as 'YYYY-MM-DD' strings. By default pg turns them into a JS Date
// at local midnight, which can shift the day by one when serialised to JSON as UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Catches the common copy-paste mistakes early, with a message that says how to fix them.
function parseDatabaseUrl(connectionString) {
  if (connectionString.includes('[YOUR-PASSWORD]')) {
    throw new Error('DATABASE_URL still contains [YOUR-PASSWORD]. Replace it with the database password.');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    url = null;
  }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must be a connection string starting with postgresql://');
  }
  return url;
}

// Supabase requires SSL. A local Postgres (e.g. in Docker) usually has it turned off.
function sslConfig(connectionString) {
  const { hostname } = parseDatabaseUrl(connectionString);
  return LOCAL_HOSTS.has(hostname) ? false : { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig(DATABASE_URL),
  // Fail fast when the database is unreachable instead of hanging indefinitely.
  connectionTimeoutMillis: 10_000,
});

// An idle client can lose its connection (e.g. the database restarts). Log it
// instead of letting the unhandled 'error' event crash the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}
