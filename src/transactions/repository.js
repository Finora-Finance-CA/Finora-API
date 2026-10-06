// Database access for transactions. All SQL is parameterized.

import { query } from '../db.js';

// Columns returned to the client. Shared so future list/update queries return the same shape.
// id is a BIGINT, which pg returns as a string to avoid losing precision.
export const TRANSACTION_COLUMNS = `
  id, user_id, amount_cents, date, type, category, description, created_at, updated_at
`;

/**
 * Inserts a transaction for a user and returns the new row.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {{ amount_cents: number, date: string, type: string, category: string|null, description: string|null }} data
 *   Values already checked by validateCreateTransaction.
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
