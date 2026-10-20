// Validation for budget requests (US-31, US-33): the JSON body and the :id in the URL.
// Pure functions with no Express or database dependencies.

import { BUDGET_CATEGORIES } from '../constants.js';
import { validatePositiveCents, validateTransactionId } from '../transactions/validation.js';

/**
 * Checks a budget id from the URL, e.g. PUT /api/budgets/:id. Budget ids are BIGINT
 * identity values, like transaction ids, so the rules are the same.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export const validateBudgetId = validateTransactionId;

function validateCategory(value) {
  if (value === undefined || value === null || value === '') return 'category is required.';
  if (!BUDGET_CATEGORIES.includes(value)) return `category must be one of: ${BUDGET_CATEGORIES.join(', ')}.`;
  return null;
}

function checkBody(body, checks) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object. Set Content-Type: application/json.' } };
  }
  const errors = Object.fromEntries(
    Object.entries(checks(body)).filter(([, message]) => message !== null)
  );
  return Object.keys(errors).length > 0 ? { errors } : { errors: null };
}

/**
 * Validates the body of POST /api/budgets: { category, limit_cents }. Only those
 * fields are read; anything else (including id and user_id) is ignored.
 *
 * @param {unknown} body
 * @returns {{ errors: Record<string, string> } | { errors: null, value: { category: string, limit_cents: number } }}
 */
export function validateNewBudget(body) {
  const result = checkBody(body, ({ category, limit_cents }) => ({
    category: validateCategory(category),
    limit_cents: validatePositiveCents(limit_cents, 'limit_cents'),
  }));
  if (result.errors) return result;
  return { errors: null, value: { category: body.category, limit_cents: body.limit_cents } };
}

/**
 * Validates the body of PUT /api/budgets/:id: { limit_cents }. A budget's category
 * can't change (delete it and add another instead), so any other field is ignored.
 *
 * @param {unknown} body
 * @returns {{ errors: Record<string, string> } | { errors: null, value: { limit_cents: number } }}
 */
export function validateBudgetUpdate(body) {
  const result = checkBody(body, ({ limit_cents }) => ({
    limit_cents: validatePositiveCents(limit_cents, 'limit_cents'),
  }));
  if (result.errors) return result;
  return { errors: null, value: { limit_cents: body.limit_cents } };
}
