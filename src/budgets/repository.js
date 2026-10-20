// Database access for budgets. All SQL is parameterized.
//
// Every function takes the owner's id first and only reads or changes that user's
// rows, so one user can never see or change another user's budgets.

import { CATEGORIES } from '../constants.js';
import { query } from '../db.js';

// Columns returned to the client. id is a BIGINT, which pg returns as a string.
export const BUDGET_COLUMNS = 'id, user_id, category, limit_cents, created_at, updated_at';

// The order the categories are listed in everywhere (categories.sort_order).
const categoryOrder = (budget) => CATEGORIES.indexOf(budget.category);

/**
 * A user's budgets, in category order.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @returns {Promise<object[]>}
 */
export async function listBudgets(userId) {
  const { rows } = await query(`SELECT ${BUDGET_COLUMNS} FROM public.budgets WHERE user_id = $1`, [userId]);
  return rows.sort((a, b) => categoryOrder(a) - categoryOrder(b));
}

/**
 * Adds a budget for a user and returns it. Fails with Postgres error 23505
 * (budgets_user_id_category_key) if the user already has one for that category.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {{ category: string, limit_cents: number }} data Checked by validateNewBudget.
 * @returns {Promise<object>}
 */
export async function insertBudget(userId, { category, limit_cents }) {
  const { rows } = await query(
    `INSERT INTO public.budgets (user_id, category, limit_cents)
     VALUES ($1, $2, $3)
     RETURNING ${BUDGET_COLUMNS}`,
    [userId, category, limit_cents]
  );
  return rows[0];
}

/**
 * Changes a budget's limit, but only if the user owns it. updated_at is set by the
 * budgets_set_updated_at trigger.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} budgetId Checked by validateBudgetId.
 * @param {number} limitCents Checked by validateBudgetUpdate.
 * @returns {Promise<object|null>} The updated budget, or null if the user has no budget
 *   with that id (it doesn't exist or someone else owns it).
 */
export async function updateBudgetLimit(userId, budgetId, limitCents) {
  const { rows } = await query(
    `UPDATE public.budgets
     SET limit_cents = $3
     WHERE id = $1 AND user_id = $2
     RETURNING ${BUDGET_COLUMNS}`,
    [budgetId, userId, limitCents]
  );
  return rows[0] ?? null;
}

/**
 * Deletes a budget, but only if the user owns it.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} budgetId Checked by validateBudgetId.
 * @returns {Promise<boolean>} true if a budget was deleted.
 */
export async function deleteBudget(userId, budgetId) {
  const { rowCount } = await query('DELETE FROM public.budgets WHERE id = $1 AND user_id = $2', [
    budgetId,
    userId,
  ]);
  return rowCount > 0;
}
