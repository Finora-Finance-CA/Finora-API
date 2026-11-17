// The steps of npm run seed:perf in order (US-62), with Supabase and the database passed
// in so they can be replaced in tests. scripts/seedPerf.js supplies the real ones.

import { readSeedConfig } from './config.js';
import { generatePerfTransactions } from './perfTransactions.js';
import { replacePerfTransactions } from './replacePerfTransactions.js';
import { signInOrCreateSampleUser } from './sampleUsers.js';

/**
 * @param {object} options
 * @param {Record<string, string|undefined>} options.env Usually process.env. Checked
 *   first: in production, or with a variable missing, nothing else happens.
 * @param {() => import('@supabase/supabase-js').SupabaseClient['auth']} options.getAuth
 * @param {() => Promise<{ connect(): Promise<object>, end(): Promise<void> }>} options.getPool
 *   Only called after the checks, since loading src/db.js connects to the database.
 * @param {string} options.today YYYY-MM-DD.
 * @param {boolean} [options.remove] Only remove the perf rows.
 * @returns {Promise<{ email: string, removed: number, inserted: number }>}
 */
export async function seedPerfData({ env, getAuth, getPool, today, remove = false }) {
  const { users } = readSeedConfig(env);
  const transactions = remove ? [] : generatePerfTransactions(today);
  // The demo user is the first sample user, signed in (or created) the same way npm run
  // seed does it, before anything is written.
  const { id, email } = await signInOrCreateSampleUser(getAuth(), users[0]);

  const pool = await getPool();
  try {
    const { removed, inserted } = await replacePerfTransactions(pool, id, transactions);
    return { email, removed, inserted };
  } finally {
    await pool.end();
  }
}
