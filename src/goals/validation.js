// Validation for savings goal requests (US-47): the JSON body and the :id in the URL.
// Pure functions with no Express or database dependencies.

import { validateDate, validatePositiveCents, validateTransactionId } from '../transactions/validation.js';

// Mirrors the goals_name_length CHECK in db/migrations/006_create_goals.sql.
export const MAX_GOAL_NAME_LENGTH = 60;

/**
 * Checks a goal id from the URL, e.g. PUT /api/goals/:id. Goal ids are BIGINT identity
 * values, like transaction ids, so the rules are the same.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export const validateGoalId = validateTransactionId;

// Counted in characters as Postgres counts them (code points), so an emoji is one.
const characterCount = (text) => [...text].length;

function validateName(value) {
  if (value === undefined || value === null) return 'name is required.';
  if (typeof value !== 'string') return 'name must be a string.';
  const name = value.trim();
  if (name === '') return 'name is required.';
  if (characterCount(name) > MAX_GOAL_NAME_LENGTH) return `name must be at most ${MAX_GOAL_NAME_LENGTH} characters.`;
  return null;
}

// Optional: missing, null or "" means the goal has no target date.
function validateTargetDate(value) {
  if (value === undefined || value === null || value === '') return null;
  return validateDate(value, 'target_date');
}

/**
 * @typedef {object} GoalInput
 * @property {string} name Trimmed.
 * @property {number} target_cents
 * @property {string|null} target_date YYYY-MM-DD, or null for none.
 */

/**
 * Validates the body of POST /api/goals and PUT /api/goals/:id. An update replaces
 * every field, so both take the same fields and follow the same rules: leaving
 * target_date out of a PUT clears it.
 *
 * The value is built only from name, target_cents and target_date, so user_id, id and
 * saved_cents (changed only by contributions, US-49) can never be set this way.
 *
 * @param {unknown} body
 * @returns {{ errors: Record<string, string> } | { errors: null, value: GoalInput }}
 */
export function validateGoalBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object. Set Content-Type: application/json.' } };
  }

  const { name, target_cents, target_date } = body;
  const checks = {
    name: validateName(name),
    target_cents: validatePositiveCents(target_cents, 'target_cents'),
    target_date: validateTargetDate(target_date),
  };
  const errors = Object.fromEntries(Object.entries(checks).filter(([, message]) => message !== null));
  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: null,
    value: { name: name.trim(), target_cents, target_date: target_date || null },
  };
}
