// Database access for savings goals. All SQL is parameterized.
//
// Every function takes the owner's id first and only reads or changes that user's
// rows, so one user can never see or change another user's goals.

import { query } from '../db.js';
import { toSafeInteger } from '../summary/totals.js';

// Columns returned to the client. id is a BIGINT, which pg returns as a string.
export const GOAL_COLUMNS = 'id, user_id, name, target_cents, saved_cents, target_date, created_at, updated_at';

/**
 * A goal as the API returns it. target_cents and saved_cents are BIGINT columns, which
 * pg returns as strings so no precision is lost; they're turned back into numbers here.
 *
 * @param {object} row
 * @returns {object}
 */
export function toGoal(row) {
  return { ...row, target_cents: toSafeInteger(row.target_cents), saved_cents: toSafeInteger(row.saved_cents) };
}

/**
 * A user's goals, newest first.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @returns {Promise<object[]>}
 */
export async function listGoals(userId) {
  const { rows } = await query(
    `SELECT ${GOAL_COLUMNS} FROM public.goals WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return rows.map(toGoal);
}

/**
 * Adds a goal for a user and returns it, with nothing saved yet.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {import('./validation.js').GoalInput} data Checked by validateGoalBody.
 * @returns {Promise<object>}
 */
export async function insertGoal(userId, { name, target_cents, target_date }) {
  const { rows } = await query(
    `INSERT INTO public.goals (user_id, name, target_cents, target_date)
     VALUES ($1, $2, $3, $4)
     RETURNING ${GOAL_COLUMNS}`,
    [userId, name, target_cents, target_date]
  );
  return toGoal(rows[0]);
}

/**
 * Replaces a goal's name, target and target date, but only if the user owns it.
 * saved_cents is never changed here. updated_at is set by the goals_set_updated_at
 * trigger.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} goalId Checked by validateGoalId.
 * @param {import('./validation.js').GoalInput} data Checked by validateGoalBody.
 * @returns {Promise<object|null>} The updated goal, or null if the user has no goal
 *   with that id (it doesn't exist or someone else owns it).
 */
export async function updateGoal(userId, goalId, { name, target_cents, target_date }) {
  const { rows } = await query(
    `UPDATE public.goals
     SET name = $3, target_cents = $4, target_date = $5
     WHERE id = $1 AND user_id = $2
     RETURNING ${GOAL_COLUMNS}`,
    [goalId, userId, name, target_cents, target_date]
  );
  return rows[0] ? toGoal(rows[0]) : null;
}

/**
 * Deletes a goal, but only if the user owns it.
 *
 * @param {string} userId The owner's id, taken from the verified token.
 * @param {string} goalId Checked by validateGoalId.
 * @returns {Promise<boolean>} true if a goal was deleted.
 */
export async function deleteGoal(userId, goalId) {
  const { rowCount } = await query('DELETE FROM public.goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
  return rowCount > 0;
}
