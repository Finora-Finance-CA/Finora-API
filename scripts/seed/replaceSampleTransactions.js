// Replaces the sample users' transactions in one database transaction: their old rows
// are deleted and the new ones inserted together, or nothing changes at all. Rows that
// belong to anyone else are never touched.

import { validateTransactionBody } from '../../src/transactions/validation.js';
import { SeedError } from './errors.js';

const COLUMNS = Object.freeze(['user_id', 'amount_cents', 'date', 'type', 'category', 'description']);

/**
 * @param {{ connect(): Promise<{ query: Function, release(): void }> }} pool
 * @param {{ userId: string, transactions: object[] }[]} samples
 * @returns {Promise<{ removed: number, inserted: number }>}
 * @throws {SeedError} If a sample transaction breaks the API's rules. Checked before
 *   connecting, so nothing is written.
 */
export async function replaceSampleTransactions(pool, samples) {
  const rows = samples.flatMap(({ userId, transactions }) => transactions.map((t) => toRow(userId, t)));
  if (rows.length === 0) {
    throw new SeedError('There are no sample transactions to load.');
  }
  const userIds = samples.map(({ userId }) => userId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: removed } = await client.query(
      'DELETE FROM public.transactions WHERE user_id = ANY($1::uuid[])',
      [userIds]
    );
    const { rowCount: inserted } = await client.query(insertStatement(rows.length), rows.flat());
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

// Runs each row through the API's own validation, so the sample data can never hold
// something a user couldn't have entered.
function toRow(userId, transaction) {
  const { errors, value } = validateTransactionBody(transaction);
  if (errors) {
    throw new SeedError(`Invalid sample transaction ${JSON.stringify(transaction)}: ${Object.values(errors).join(' ')}`);
  }
  return COLUMNS.map((column) => (column === 'user_id' ? userId : value[column]));
}

function insertStatement(rowCount) {
  const placeholders = Array.from({ length: rowCount }, (_, row) => {
    const params = COLUMNS.map((_, column) => `$${row * COLUMNS.length + column + 1}`);
    return `(${params.join(', ')})`;
  });
  return `INSERT INTO public.transactions (${COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`;
}
