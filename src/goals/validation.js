// Validation for savings goal requests (US-47, US-49): the JSON body, a contribution and
// the :id in the URL. Pure functions with no Express or database dependencies. The
// shared checks and their messages are in ../validation/rules.js.

import {
  MESSAGES,
  collectErrors,
  isJsonObject,
  isMissing,
  validateCents,
  validateDate,
  validateId,
  validateText,
} from '../validation/rules.js';

// Mirrors the goals_name_length CHECK in db/migrations/006_create_goals.sql.
export const MAX_GOAL_NAME_LENGTH = 60;

// How each field is named in messages.
export const LABELS = Object.freeze({
  name: 'Name',
  target_cents: 'Target',
  target_date: 'Target date',
  contribution: 'Amount',
});

/**
 * Checks a goal id from the URL, e.g. PUT /api/goals/:id.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export const validateGoalId = validateId;

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
  if (!isJsonObject(body)) {
    return { errors: { body: MESSAGES.bodyNotObject } };
  }

  const { name, target_cents, target_date } = body;
  const errors = collectErrors({
    name: validateText(name, LABELS.name, { required: true, max: MAX_GOAL_NAME_LENGTH }),
    target_cents: validateCents(target_cents, LABELS.target_cents),
    // Optional: missing, null or "" means the goal has no target date.
    target_date: validateDate(target_date, LABELS.target_date, { required: false }),
  });
  if (errors) {
    return { errors };
  }

  return {
    errors: null,
    value: { name: name.trim(), target_cents, target_date: isMissing(target_date) ? null : target_date },
  };
}

/**
 * Validates POST /api/goals/:id/contributions: the :id and { amount_cents }, the amount
 * added to the goal's saved_cents. Every problem is reported at once.
 *
 * @param {unknown} id The raw route parameter.
 * @param {unknown} body
 * @returns {{ errors: Record<string, string> } | { errors: null, value: { amount_cents: number } }}
 */
export function validateContribution(id, body) {
  const errors = collectErrors({
    id: validateId(id),
    ...(isJsonObject(body)
      ? { amount_cents: validateCents(body.amount_cents, LABELS.contribution) }
      : { body: MESSAGES.bodyNotObject }),
  });
  if (errors) return { errors };
  return { errors: null, value: { amount_cents: body.amount_cents } };
}
