// Validation for transaction requests: the JSON body, the :id in the URL and the
// list's query string. Pure functions with no Express or database dependencies, so
// they can be unit tested directly. The shared checks and their messages are in
// ../validation/rules.js.

import { CATEGORIES, MAX_AMOUNT_CENTS, MIN_YEAR, TRANSACTION_TYPES } from '../constants.js';
import {
  MAX_ID,
  MESSAGES,
  collectErrors,
  isJsonObject,
  isMissing,
  validateCents,
  validateChoice,
  validateDate as validateDateRule,
  validateId,
  validateText,
} from '../validation/rules.js';

// Re-exported so existing imports from this module keep working.
export { CATEGORIES, MAX_AMOUNT_CENTS, MIN_YEAR, TRANSACTION_TYPES };

export const MAX_DESCRIPTION_LENGTH = 255;
// Search text is matched against descriptions, so it can't usefully be longer.
export const MAX_SEARCH_LENGTH = MAX_DESCRIPTION_LENGTH;
// Far beyond any real history at 20 per page; stops absurd OFFSETs reaching Postgres.
export const MAX_PAGE = 100_000;

export const MAX_TRANSACTION_ID = MAX_ID;

// How each field is named in messages.
export const LABELS = Object.freeze({
  amount_cents: 'Amount',
  date: 'Date',
  type: 'Type',
  category: 'Category',
  description: 'Description',
  page: 'Page',
  q: 'Search',
  from: 'From date',
  to: 'To date',
});

const PAGE_PATTERN = /^[1-9]\d*$/;

/**
 * A money amount in integer cents (see validateCents in ../validation/rules.js).
 *
 * @param {unknown} value
 * @param {string} [label] How the message names the field.
 * @returns {string|null} An error message, or null if it's valid.
 */
export function validatePositiveCents(value, label = LABELS.amount_cents) {
  return validateCents(value, label);
}

/**
 * A required YYYY-MM-DD date (see validateDate in ../validation/rules.js).
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {string|null}
 */
export function validateDate(value, label = LABELS.date) {
  return validateDateRule(value, label);
}

/**
 * Checks a transaction id taken from the URL, e.g. PUT /api/transactions/:id.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export const validateTransactionId = validateId;

function validateCategory(value, type) {
  // Only an expense needs a category; an income may have one.
  return validateChoice(value, LABELS.category, CATEGORIES, { required: false }) ??
    (type === 'expense' && isMissing(value) ? `${LABELS.category} is required for an expense.` : null);
}

/**
 * Validates the body of a create (POST) or update (PUT) request. An update replaces
 * every field, so both take the same fields and follow the same rules.
 *
 * Only the known fields are read; anything else (including id and user_id) is ignored.
 *
 * @param {unknown} body The parsed JSON request body.
 * @returns {{ errors: Record<string, string> } | { errors: null, value: object }}
 *   Either every invalid field with a message, or the cleaned values ready to save.
 */
export function validateTransactionBody(body) {
  if (!isJsonObject(body)) {
    return { errors: { body: MESSAGES.bodyNotObject } };
  }

  const { amount_cents, date, type, category, description } = body;
  const errors = collectErrors({
    amount_cents: validateCents(amount_cents, LABELS.amount_cents),
    date: validateDateRule(date, LABELS.date),
    type: validateChoice(type, LABELS.type, TRANSACTION_TYPES),
    category: validateCategory(category, type),
    description: validateText(description, LABELS.description, { max: MAX_DESCRIPTION_LENGTH }),
  });
  if (errors) {
    return { errors };
  }

  const trimmedDescription = typeof description === 'string' ? description.trim() : '';
  return {
    errors: null,
    value: {
      amount_cents,
      date,
      type,
      category: isMissing(category) ? null : category,
      description: trimmedDescription === '' ? null : trimmedDescription,
    },
  };
}

/**
 * The filters for GET /api/transactions, already checked by validateListQuery.
 *
 * @typedef {object} TransactionListQuery
 * @property {number} page 1-based.
 * @property {string|null} q Search text, trimmed; null for no search.
 * @property {string[]} categories Empty for every category.
 * @property {string|null} from YYYY-MM-DD, inclusive; null for no lower bound.
 * @property {string|null} to YYYY-MM-DD, inclusive; null for no upper bound.
 */

function validatePage(value) {
  if (value === undefined || value === '') return { value: 1 };
  if (Array.isArray(value)) return { error: MESSAGES.onlyOnce(LABELS.page) };
  if (typeof value !== 'string' || !PAGE_PATTERN.test(value) || Number(value) > MAX_PAGE) {
    return { error: `${LABELS.page} must be a whole number from 1 to ${MAX_PAGE.toLocaleString('en-CA')}.` };
  }
  return { value: Number(value) };
}

function validateSearch(value) {
  if (value === undefined) return { value: null };
  if (Array.isArray(value)) return { error: MESSAGES.onlyOnce(LABELS.q) };
  const error = validateText(value, LABELS.q, { max: MAX_SEARCH_LENGTH });
  if (error) return { error };
  const text = value.trim();
  return { value: text === '' ? null : text };
}

// One category (?category=Food) or several (?category=Food&category=Housing).
function validateCategories(value) {
  if (value === undefined) return { value: [] };
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => typeof item !== 'string')) return { error: MESSAGES.text(LABELS.category) };
  // An empty value (?category=) means no filter, as an unticked box would.
  const chosen = values.filter((item) => item !== '');
  if (chosen.some((item) => !CATEGORIES.includes(item))) {
    return { error: MESSAGES.choice(LABELS.category, CATEGORIES) };
  }
  // In the API's category order, without repeats.
  return { value: CATEGORIES.filter((category) => chosen.includes(category)) };
}

function validateBound(value, field) {
  if (value === undefined || value === '') return { value: null };
  if (Array.isArray(value)) return { error: MESSAGES.onlyOnce(LABELS[field]) };
  const error = validateDateRule(value, LABELS[field]);
  return error ? { error } : { value };
}

/**
 * Validates the query string of GET /api/transactions. Every parameter is optional,
 * and unknown parameters are ignored.
 *
 *   page      1-based page number (default 1)
 *   q         text the description must contain, case-insensitive
 *   category  one or more categories; repeat the parameter for several
 *   from, to  inclusive date range, YYYY-MM-DD
 *
 * @param {Record<string, unknown>} query The parsed query string (req.query).
 * @returns {{ errors: Record<string, string> } | { errors: null, value: TransactionListQuery }}
 */
export function validateListQuery(query = {}) {
  const checks = {
    page: validatePage(query.page),
    q: validateSearch(query.q),
    category: validateCategories(query.category),
    from: validateBound(query.from, 'from'),
    to: validateBound(query.to, 'to'),
  };

  // Only compare the range once both ends are real dates. Same-format YYYY-MM-DD
  // strings compare correctly as text.
  const { from, to } = checks;
  if (from.value && to.value && from.value > to.value) {
    checks.to = { error: `${LABELS.to} must be on or after the ${LABELS.from}.` };
  }

  const errors = collectErrors(Object.fromEntries(Object.entries(checks).map(([field, check]) => [field, check.error ?? null])));
  if (errors) {
    return { errors };
  }

  return {
    errors: null,
    value: {
      page: checks.page.value,
      q: checks.q.value,
      categories: checks.category.value,
      from: checks.from.value,
      to: checks.to.value,
    },
  };
}
