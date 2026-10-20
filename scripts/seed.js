// Loads sample data for development: two sample users, each with about three months
// of transactions across every category. Running it again resets those two users'
// transactions to the same sample set; nobody else's data is touched.
//
// Usage: npm run seed (see "Sample data" in the README).

import 'dotenv/config';
import { getSupabase } from '../src/auth/supabase.js';
import { readSeedConfig } from './seed/config.js';
import { SeedError } from './seed/errors.js';
import { localDateString } from './seed/sampleTransactions.js';
import { seedSampleData } from './seed/seedSampleData.js';

async function main() {
  const { users } = readSeedConfig(process.env);
  const today = localDateString(new Date());

  // Imported only after the checks above: db.js reads DATABASE_URL as soon as it loads,
  // and the production check must come first.
  const { pool } = await import('../src/db.js');
  try {
    const result = await seedSampleData({ users, auth: getSupabase().auth, pool, today });
    printSummary(result, today);
  } finally {
    await pool.end();
  }
}

function printSummary({ users, removed, inserted }, today) {
  console.log(`Sample data loaded, dated up to ${today}:`);
  for (const { email, created, transactionCount } of users) {
    console.log(`  ${email} (${created ? 'created' : 'existing account'}): ${transactionCount} transactions`);
  }
  console.log(`Removed ${removed} earlier sample transactions and added ${inserted}. Other users' data was not touched.`);
}

// Connection failures can be an AggregateError (one error per address) with an empty
// message, so fall back to the error code.
function describeError(err) {
  return err?.message || err?.code || String(err);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof SeedError ? `Seed failed: ${err.message}` : `Seed failed unexpectedly: ${describeError(err)}`);
  process.exitCode = 1;
}
