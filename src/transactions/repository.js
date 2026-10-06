// Database access for transactions. All SQL is parameterized.
//
// Every function takes the owner's userId first and only touches that user's rows.
// To add a column: write a migration, add it to TRANSACTION_COLUMNS, TransactionInput,
// insertTransaction and updateTransaction, and to validateTransactionBody in validation.js.

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
 * Inserts a transaction for a user and returns the new row.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {TransactionInput} data
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
 * Returns a user's most recent transactions, newest first. Ties on date are broken by
 * when the row was created, then by id, so the order is always the same.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {number} limit Maximum number of rows to return.
 */
export async function listTransactions(userId, limit) {
  const { rows } = await query(
    `SELECT ${TRANSACTION_COLUMNS}
     FROM public.transactions
     WHERE user_id = $1
     ORDER BY date DESC, created_at DESC, id DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/**
 * Replaces every editable field of a transaction, but only if the user owns it.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} transactionId Already checked by validateTransactionId.
 * @param {TransactionInput} data
 * @returns {Promise<object|null>} The updated row, or null if no transaction with that
 *   id belongs to the user (it doesn't exist or someone else owns it).
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
 * @returns {Promise<boolean>} true if a row was deleted, false if no transaction with
 *   that id belongs to the user.
 */
export async function deleteTransaction(userId, transactionId) {
  const { rowCount } = await query(
    'DELETE FROM public.transactions WHERE id = $1 AND user_id = $2',
    [transactionId, userId]
  );
  return rowCount > 0;
}
