// The seed's steps in order, with Supabase and the database passed in so they can be
// replaced in tests. scripts/seed.js supplies the real ones.

import { replaceSampleTransactions } from './replaceSampleTransactions.js';
import { generateSampleTransactions } from './sampleTransactions.js';
import { signInOrCreateSampleUser } from './sampleUsers.js';

/**
 * @param {object} options
 * @param {{ email: string, password: string }[]} options.users From readSeedConfig; user N gets sample profile N.
 * @param {import('@supabase/supabase-js').SupabaseClient['auth']} options.auth
 * @param {{ connect(): Promise<object> }} options.pool
 * @param {string} options.today YYYY-MM-DD; sample dates count back from it.
 * @returns {Promise<{ users: { email: string, created: boolean, transactionCount: number }[], removed: number, inserted: number }>}
 */
export async function seedSampleData({ users, auth, pool, today }) {
  // Every sample user is signed in or created before anything is written, so a Supabase
  // failure leaves the transactions table untouched. One at a time, to stay clear of
  // Supabase's rate limits.
  const samples = [];
  for (const [index, credentials] of users.entries()) {
    const { id, email, created } = await signInOrCreateSampleUser(auth, credentials);
    samples.push({ userId: id, email, created, transactions: generateSampleTransactions(index, today) });
  }

  const { removed, inserted } = await replaceSampleTransactions(pool, samples);
  return {
    users: samples.map(({ email, created, transactions }) => ({ email, created, transactionCount: transactions.length })),
    removed,
    inserted,
  };
}
