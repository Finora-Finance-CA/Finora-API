// Validation for budget requests (US-31, US-33): the JSON body and the :id in the URL.
// Pure functions with no Express or database dependencies. The shared checks and their
// messages are in ../validation/rules.js.

import { BUDGET_CATEGORIES } from '../constants.js';
import { MESSAGES, collectErrors, isJsonObject, validateCents, validateChoice, validateId } from '../validation/rules.js';

// How each field is named in messages.
export const LABELS = Object.freeze({ category: 'Category', limit_cents: 'Limit' });

/**
 * Checks a budget id from the URL, e.g. PUT /api/budgets/:id.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export const validateBudgetId = validateId;

function checkBody(body, checks) {
  if (!isJsonObject(body)) {
    return { errors: { body: MESSAGES.bodyNotObject } };
  }
  return { errors: collectErrors(checks(body)) };
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
    category: validateChoice(category, LABELS.category, BUDGET_CATEGORIES),
    limit_cents: validateCents(limit_cents, LABELS.limit_cents),
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
    limit_cents: validateCents(limit_cents, LABELS.limit_cents),
  }));
  if (result.errors) return result;
  return { errors: null, value: { limit_cents: body.limit_cents } };
}
