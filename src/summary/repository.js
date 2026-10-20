// Database access for the monthly summary. All SQL is parameterized, and every query
// is limited to one user's rows.

import { query } from '../db.js';

/**
 * A user's total and count of transactions per type in a date range. A type with no
 * transactions in the range has no row.
 *
 * Postgres sums the INTEGER amounts as BIGINT, so a total can't overflow; pg returns
 * BIGINT as a string, which summarizeTotals (totals.js) turns back into a number.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {{ start: string, end: string }} range YYYY-MM-DD; start inclusive, end exclusive.
 * @returns {Promise<import('./totals.js').TotalsRow[]>}
 */
export async function totalsByType(userId, { start, end }) {
  const { rows } = await query(
    `SELECT type, SUM(amount_cents) AS total_cents, COUNT(*) AS transaction_count
     FROM public.transactions
     WHERE user_id = $1 AND date >= $2 AND date < $3
     GROUP BY type`,
    [userId, start, end]
  );
  return rows;
}
