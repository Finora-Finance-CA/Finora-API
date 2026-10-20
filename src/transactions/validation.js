// Validation for transaction requests: the JSON body, the :id in the URL and the
// list's query string. Pure functions with no Express or database dependencies, so
// they can be unit tested directly.

import { CATEGORIES, MAX_AMOUNT_CENTS, TRANSACTION_TYPES } from '../constants.js';

// Re-exported so existing imports from this module keep working.
export { CATEGORIES, MAX_AMOUNT_CENTS, TRANSACTION_TYPES };

export const MAX_DESCRIPTION_LENGTH = 255;
export const MIN_YEAR = 1900;
// Search text is matched against descriptions, so it can't usefully be longer.
export const MAX_SEARCH_LENGTH = MAX_DESCRIPTION_LENGTH;
// Far beyond any real history at 20 per page; stops absurd OFFSETs reaching Postgres.
export const MAX_PAGE = 100_000;

// Largest value a Postgres BIGINT column (transactions.id) can hold.
export const MAX_TRANSACTION_ID = 9_223_372_036_854_775_807n;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Digits only: no sign, decimals or leading zeros. Identity ids start at 1.
const TRANSACTION_ID_PATTERN = /^[1-9]\d*$/;
const PAGE_PATTERN = /^[1-9]\d*$/;

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function validateAmountCents(value) {
  if (isMissing(value)) return 'amount_cents is required.';
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.';
  }
  if (value <= 0) return 'amount_cents must be greater than zero.';
  if (value > MAX_AMOUNT_CENTS) return `amount_cents must be at most ${MAX_AMOUNT_CENTS}.`;
  return null;
}

// `field` names the value in the message: the body's `date`, or the list's `from` and `to`.
function validateDate(value, field = 'date') {
  if (isMissing(value)) return `${field} is required.`;
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) return `${field} must be a string in YYYY-MM-DD format.`;

  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC rolls invalid days over (Feb 30 becomes Mar 2), so compare the parts back.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!isRealDate) return `${field} must be a real calendar date.`;
  if (year < MIN_YEAR) return `${field} must be in ${MIN_YEAR} or later.`;
  return null;
}

function validateType(value) {
  if (isMissing(value)) return 'type is required.';
  if (!TRANSACTION_TYPES.includes(value)) return `type must be one of: ${TRANSACTION_TYPES.join(', ')}.`;
  return null;
}

function validateCategory(value, type) {
  if (isMissing(value)) {
    return type === 'expense' ? 'category is required for an expense.' : null;
  }
  if (!CATEGORIES.includes(value)) return `category must be one of: ${CATEGORIES.join(', ')}.`;
  return null;
}

function validateDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'description must be a string.';
  if (value.trim().length > MAX_DESCRIPTION_LENGTH) {
    return `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  return null;
}

/**
 * Checks a transaction id taken from the URL, e.g. PUT /api/transactions/:id.
 *
 * Without this, a value like "abc" or "1.5" would reach Postgres, fail to cast to
 * BIGINT and turn into a 500 instead of a 400.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null} An error message, or null if the id is valid.
 */
export function validateTransactionId(value) {
  if (typeof value !== 'string' || !TRANSACTION_ID_PATTERN.test(value) || BigInt(value) > MAX_TRANSACTION_ID) {
    return 'id must be a positive whole number.';
  }
  return null;
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
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object. Set Content-Type: application/json.' } };
  }

  const { amount_cents, date, type, category, description } = body;
  const checks = {
    amount_cents: validateAmountCents(amount_cents),
    date: validateDate(date),
    type: validateType(type),
    category: validateCategory(category, type),
    description: validateDescription(description),
  };

  const errors = Object.fromEntries(Object.entries(checks).filter(([, message]) => message !== null));
  if (Object.keys(errors).length > 0) {
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

const SINGLE_VALUE = (field) => `${field} must be given only once.`;

function validatePage(value) {
  if (value === undefined || value === '') return { value: 1 };
  if (Array.isArray(value)) return { error: SINGLE_VALUE('page') };
  if (typeof value !== 'string' || !PAGE_PATTERN.test(value) || Number(value) > MAX_PAGE) {
    return { error: `page must be a whole number from 1 to ${MAX_PAGE}.` };
  }
  return { value: Number(value) };
}

function validateSearch(value) {
  if (value === undefined) return { value: null };
  if (Array.isArray(value)) return { error: SINGLE_VALUE('q') };
  if (typeof value !== 'string') return { error: 'q must be text.' };
  const text = value.trim();
  if (text.length > MAX_SEARCH_LENGTH) return { error: `q must be at most ${MAX_SEARCH_LENGTH} characters.` };
  return { value: text === '' ? null : text };
}

// One category (?category=Food) or several (?category=Food&category=Housing).
function validateCategories(value) {
  if (value === undefined) return { value: [] };
  const values = Array.isArray(value) ? value : [value];
  if (values.some((item) => typeof item !== 'string')) return { error: 'category must be text.' };
  // An empty value (?category=) means no filter, as an unticked box would.
  const chosen = values.filter((item) => item !== '');
  if (chosen.some((item) => !CATEGORIES.includes(item))) {
    return { error: `category must be one of: ${CATEGORIES.join(', ')}.` };
  }
  // In the API's category order, without repeats.
  return { value: CATEGORIES.filter((category) => chosen.includes(category)) };
}

function validateBound(value, field) {
  if (value === undefined || value === '') return { value: null };
  if (Array.isArray(value)) return { error: SINGLE_VALUE(field) };
  const error = validateDate(value, field);
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
    checks.to = { error: 'to must be on or after from.' };
  }

  const errors = Object.fromEntries(
    Object.entries(checks)
      .filter(([, check]) => check.error)
      .map(([field, check]) => [field, check.error])
  );
  if (Object.keys(errors).length > 0) {
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
