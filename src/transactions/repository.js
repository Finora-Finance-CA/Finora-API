// Database access for transactions. All SQL is parameterized.
//
// Every function takes the owner's id first and only reads or changes that user's
// rows, so one user can never see or change another user's transactions.
//
// To add an editable column:
//   1. Add a migration in db/migrations (never edit an applied one).
//   2. Add the column to TRANSACTION_COLUMNS and TransactionInput below, and to the
//      SQL in insertTransaction and updateTransaction.
//   3. Validate it in validateTransactionBody (validation.js) and document it in the README.
//   4. Tell the front-end, whose form constants mirror these rules.

import { query } from '../db.js';

// Columns returned to the client. Shared so every query returns the same shape.
// id is a BIGINT, which pg returns as a string to avoid losing precision.
export const TRANSACTION_COLUMNS = `
  id, user_id, amount_cents, date, type, category, description, created_at, updated_at
`;

/**
 * The fields a user can set on a transaction, already checked by validateTransactionBody.
 *
 * @typedef {object} TransactionInput
 * @property {number} amount_cents
 * @property {string} date 'YYYY-MM-DD'
 * @property {'income'|'expense'} type
 * @property {string|null} category
 * @property {string|null} description
 */

/**
 * Escapes LIKE's wildcards, so a search for "50%" or "a_b" matches that text exactly.
 * Used with ESCAPE '\'.
 *
 * @param {string} text
 */
export function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// The WHERE clause for one user's transactions with the list's filters, and its
// parameters. The owner check always comes first and is never optional.
function listConditions(userId, { q, categories, from, to }) {
  const params = [userId];
  const conditions = ['user_id = $1'];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (q) add(`description ILIKE ? ESCAPE '\\'`, `%${escapeLikePattern(q)}%`);
  if (categories.length > 0) add('category = ANY(?::text[])', categories);
  if (from) add('date >= ?', from);
  if (to) add('date <= ?', to);

  return { where: conditions.join(' AND '), params };
}

/**
 * Returns one page of a user's transactions that match the filters, newest first, and
 * how many match in total. Rows on the same date are ordered by when they were created,
 * then by id, so the order never changes between calls and pages never overlap.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {import('./validation.js').TransactionListQuery} filters
 * @param {{ limit: number, offset: number }} page
 * @returns {Promise<{ transactions: object[], totalCount: number }>}
 */
export async function listTransactions(userId, filters, { limit, offset }) {
  const { where, params } = listConditions(userId, filters);
  const limitRef = params.length + 1;

  const [count, page] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total_count FROM public.transactions WHERE ${where}`, params),
    query(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM public.transactions
       WHERE ${where}
       ORDER BY date DESC, created_at DESC, id DESC
       LIMIT $${limitRef} OFFSET $${limitRef + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return { transactions: page.rows, totalCount: count.rows[0].total_count };
}

/**
 * Inserts a transaction for a user and returns the new row.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {TransactionInput} data
 * @returns {Promise<object>}
 */
export async function insertTransaction(userId, data) {
  const { rows } = await query(
    `INSERT INTO public.transactions (user_id, amount_cents, date, type, category, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${TRANSACTION_COLUMNS}`,
    [userId, data.amount_cents, data.date, data.type, data.category, data.description]
  );
  return rows[0];
}

/**
 * Replaces every editable field of a transaction, but only if the user owns it.
 * updated_at is set by the transactions_set_updated_at trigger.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} transactionId Already checked by validateTransactionId.
 * @param {TransactionInput} data
 * @returns {Promise<object|null>} The updated row, or null if the user has no
 *   transaction with that id (it doesn't exist or someone else owns it).
 */
export async function updateTransaction(userId, transactionId, data) {
  const { rows } = await query(
    `UPDATE public.transactions
     SET amount_cents = $3, date = $4, type = $5, category = $6, description = $7
     WHERE id = $1 AND user_id = $2
     RETURNING ${TRANSACTION_COLUMNS}`,
    [transactionId, userId, data.amount_cents, data.date, data.type, data.category, data.description]
  );
  return rows[0] ?? null;
}

/**
 * Deletes a transaction, but only if the user owns it.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} transactionId Already checked by validateTransactionId.
 * @returns {Promise<boolean>} true if a row was deleted, false if the user has no
 *   transaction with that id.
 */
export async function deleteTransaction(userId, transactionId) {
  const { rowCount } = await query(
    'DELETE FROM public.transactions WHERE id = $1 AND user_id = $2',
    [transactionId, userId]
  );
  return rowCount > 0;
}
