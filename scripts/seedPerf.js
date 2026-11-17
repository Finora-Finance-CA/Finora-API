// npm run seed:perf (US-62): gives the first sample user (SEED_USER_1 in .env) 1,000
// realistic transactions over the last 12 months, to check the app is still fast with a
// lot of data. Running it again replaces that set with a fresh one, so the user never
// has more than 1,000 perf rows. npm run seed:perf -- --remove takes them away again.
//
// Refuses to run when NODE_ENV is production. See "Performance check" in the README.

import 'dotenv/config';
import { getSupabase } from '../src/auth/supabase.js';
import { SeedError } from './seed/errors.js';
import { PERF_TRANSACTION_COUNT } from './seed/perfTransactions.js';
import { localDateString } from './seed/sampleTransactions.js';
import { seedPerfData } from './seed/seedPerfData.js';

function describeError(err) {
  return err?.message || err?.code || String(err);
}

async function main() {
  const remove = process.argv.includes('--remove');
  const today = localDateString(new Date());
  const { email, removed, inserted } = await seedPerfData({
    env: process.env,
    getAuth: () => getSupabase().auth,
    getPool: async () => (await import('../src/db.js')).pool,
    today,
    remove,
  });

  if (remove) {
    console.log(`Removed ${removed} perf transactions from ${email}. Their other transactions were not touched.`);
    return;
  }
  console.log(
    `${email} now has ${inserted} perf transactions dated up to ${today} (replaced ${removed} from an earlier run). ` +
      "Their other transactions, and other users' data, were not touched."
  );
  if (inserted !== PERF_TRANSACTION_COUNT) console.warn(`Expected ${PERF_TRANSACTION_COUNT} rows, inserted ${inserted}.`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof SeedError ? `Seed failed: ${err.message}` : `Seed failed unexpectedly: ${describeError(err)}`);
  process.exitCode = 1;
}
