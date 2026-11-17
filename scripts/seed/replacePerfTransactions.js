// Puts the perf set into the database for one user (US-62), in one database transaction:
// that user's earlier perf rows (marked by their created_at window) are deleted and the
// new set inserted together, or nothing changes. The user's other transactions, and
// everyone else's, are never touched.

import { validateTransactionBody } from '../../src/transactions/validation.js';
import { SeedError } from './errors.js';
import { PERF_CREATED_AT_END, PERF_CREATED_AT_START } from './perfTransactions.js';

const COLUMNS = Object.freeze(['user_id', 'amount_cents', 'date', 'type', 'category', 'description', 'created_at']);

// Runs each row through the API's own validation, so the perf data can never hold
// something a user couldn't have entered.
function toRow(userId, transaction) {
  const { errors, value } = validateTransactionBody(transaction);
  if (errors) {
    throw new SeedError(`Invalid perf transaction ${JSON.stringify(transaction)}: ${Object.values(errors).join(' ')}`);
  }
  return COLUMNS.map((column) => {
    if (column === 'user_id') return userId;
    if (column === 'created_at') return transaction.created_at;
    return value[column];
  });
}

function insertStatement(rowCount) {
  const placeholders = Array.from({ length: rowCount }, (_, row) => {
    const params = COLUMNS.map((_, column) => `$${row * COLUMNS.length + column + 1}`);
    return `(${params.join(', ')})`;
  });
  return `INSERT INTO public.transactions (${COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`;
}

/**
 * @param {{ connect(): Promise<{ query: Function, release(): void }> }} pool
 * @param {string} userId
 * @param {object[]} transactions From generatePerfTransactions. Pass [] to only remove
 *   the user's perf rows.
 * @returns {Promise<{ removed: number, inserted: number }>}
 * @throws {SeedError} If a row breaks the API's rules or isn't marked as a perf row.
 *   Checked before connecting, so nothing is written.
 */
export async function replacePerfTransactions(pool, userId, transactions) {
  const rows = transactions.map((transaction) => {
    const created = transaction.created_at;
    if (typeof created !== 'string' || created < PERF_CREATED_AT_START || created >= PERF_CREATED_AT_END) {
      throw new SeedError(`Perf transaction has a created_at outside the perf window: ${JSON.stringify(transaction)}`);
    }
    return toRow(userId, transaction);
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: removed } = await client.query(
      'DELETE FROM public.transactions WHERE user_id = $1 AND created_at >= $2 AND created_at < $3',
      [userId, PERF_CREATED_AT_START, PERF_CREATED_AT_END]
    );
    const { rowCount: inserted } =
      rows.length > 0 ? await client.query(insertStatement(rows.length), rows.flat()) : { rowCount: 0 };
    await client.query('COMMIT');
    return { removed, inserted };
  } catch (err) {
    // If the connection itself dropped, ROLLBACK fails too. Ignore that so the original
    // error is the one reported; Postgres discards the transaction anyway.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
