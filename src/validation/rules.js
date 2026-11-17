// The checks every request body and query string is built from, and the exact message
// each one gives (US-53). Pure functions with no Express or database dependencies.
//
// Every message names the field the way a person would ("Amount", "Target", "From
// date"), never by its JSON key or column name, so the front-end can show it as is.
// Documented, rule by rule, in "Validation rules" in the README.

import { MAX_AMOUNT_CENTS, MAX_YEAR, MIN_YEAR } from '../constants.js';

/** Earliest and latest dates (and months) the API accepts, inclusive. */
export const MIN_DATE = `${MIN_YEAR}-01-01`;
export const MAX_DATE = `${MAX_YEAR}-12-31`;

// Largest value a Postgres BIGINT column (every id) can hold.
export const MAX_ID = 9_223_372_036_854_775_807n;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Digits only: no sign, decimals, spaces or leading zeros. Identity ids start at 1.
const ID_PATTERN = /^[1-9]\d*$/;

const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Integer cents as dollars for a message, e.g. 2147483647 → "$21,474,836.47". Whole
 * number maths only.
 *
 * @param {number} cents A safe, non-negative whole number.
 */
export function dollarText(cents) {
  const remainder = cents % 100;
  return `$${groupThousands(String((cents - remainder) / 100))}.${String(remainder).padStart(2, '0')}`;
}

/** "income or expense", "Food, Transportation, Housing, Entertainment or Other". */
export function choiceList(choices) {
  return choices.length < 2 ? choices.join('') : `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`;
}

export const MESSAGES = Object.freeze({
  required: (label) => `${label} is required.`,
  onlyOnce: (label) => `${label} must be given only once.`,
  text: (label) => `${label} must be text.`,
  maxLength: (label, max) => `${label} must be ${max} characters or fewer.`,
  wholeCents: (label) => `${label} must be a whole number of cents, for example 1250 for $12.50.`,
  positive: (label) => `${label} must be greater than 0.`,
  maxAmount: (label) => `${label} must be ${dollarText(MAX_AMOUNT_CENTS)} or less.`,
  dateFormat: (label) => `${label} must be in YYYY-MM-DD format, for example 2026-10-05.`,
  realDate: (label) => `${label} must be a real calendar date.`,
  dateRange: (label) => `${label} must be between ${MIN_DATE} and ${MAX_DATE}.`,
  choice: (label, choices) => `${label} must be ${choices.length === 2 ? '' : 'one of '}${choiceList(choices)}.`,
  id: 'ID must be a positive whole number.',
  bodyNotObject: 'Request body must be a JSON object.',
  malformedJson: 'Request body must be valid JSON.',
});

/** Missing means not sent, null, or an empty string. */
export function isMissing(value) {
  return value === undefined || value === null || value === '';
}

/**
 * A money amount in integer cents: a JSON number, a whole number, above 0 and at most
 * MAX_AMOUNT_CENTS (the largest a Postgres INTEGER holds, $21,474,836.47).
 *
 * Strings are always rejected, numeric or not ("1250", "12abc", "1e3", "Infinity"), so
 * nothing is ever guessed from text. JSON has no NaN or Infinity, and a number too big
 * for JSON (1e400) arrives as Infinity, which isn't a whole number.
 *
 * @param {unknown} value
 * @param {string} label How the message names the field, e.g. "Amount".
 * @returns {string|null} An error message, or null if it's valid.
 */
export function validateCents(value, label) {
  if (isMissing(value)) return MESSAGES.required(label);
  if (typeof value !== 'number' || !Number.isInteger(value)) return MESSAGES.wholeCents(label);
  if (value <= 0) return MESSAGES.positive(label);
  if (value > MAX_AMOUNT_CENTS) return MESSAGES.maxAmount(label);
  return null;
}

/**
 * A date as YYYY-MM-DD text: exactly that format (no time, spaces or other order), a
 * real calendar day (no Feb 30, or Feb 29 outside a leap year), from MIN_DATE to
 * MAX_DATE.
 *
 * @param {unknown} value
 * @param {string} label
 * @param {{ required?: boolean }} [options] Not required: missing is fine.
 * @returns {string|null}
 */
export function validateDate(value, label, { required = true } = {}) {
  if (isMissing(value)) return required ? MESSAGES.required(label) : null;
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) return MESSAGES.dateFormat(label);

  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC rolls invalid days over (Feb 30 becomes Mar 2), so compare the parts back.
  // Years 0 to 99 are mapped to 1900 to 1999 by Date.UTC, so set the year separately.
  const parsed = new Date(Date.UTC(2000, month - 1, day));
  parsed.setUTCFullYear(year);
  const isReal =
    month >= 1 &&
    month <= 12 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!isReal) return MESSAGES.realDate(label);
  // Same-format YYYY-MM-DD strings compare correctly as text.
  if (value < MIN_DATE || value > MAX_DATE) return MESSAGES.dateRange(label);
  return null;
}

/**
 * One of a fixed list of values, matched exactly (case and spaces count).
 *
 * @param {unknown} value
 * @param {string} label
 * @param {readonly string[]} choices
 * @param {{ required?: boolean }} [options]
 * @returns {string|null}
 */
export function validateChoice(value, label, choices, { required = true } = {}) {
  if (isMissing(value)) return required ? MESSAGES.required(label) : null;
  if (!choices.includes(value)) return MESSAGES.choice(label, choices);
  return null;
}

/** Characters as Postgres counts them (code points), so an emoji is one. */
export function characterCount(text) {
  return [...text].length;
}

/**
 * Text that is trimmed before it's checked and saved.
 *
 * @param {unknown} value
 * @param {string} label
 * @param {{ required?: boolean, max: number }} options Required: blank after trimming
 *   counts as missing.
 * @returns {string|null}
 */
export function validateText(value, label, { required = false, max }) {
  if (value === undefined || value === null) return required ? MESSAGES.required(label) : null;
  if (typeof value !== 'string') return MESSAGES.text(label);
  const text = value.trim();
  if (required && text === '') return MESSAGES.required(label);
  if (characterCount(text) > max) return MESSAGES.maxLength(label, max);
  return null;
}

/**
 * An id from the URL, e.g. PUT /api/goals/:id. Every table's id is a BIGINT identity,
 * so the rules are the same everywhere. Without this, "abc" or "1.5" would reach
 * Postgres, fail to cast and become a 500.
 *
 * @param {unknown} value The raw route parameter.
 * @returns {string|null}
 */
export function validateId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || BigInt(value) > MAX_ID) return MESSAGES.id;
  return null;
}

/** True for a parsed JSON body that is an object (not an array, string or null). */
export function isJsonObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/**
 * Keeps the checks that failed.
 *
 * @param {Record<string, string|null>} checks Field name to message, or null if valid.
 * @returns {Record<string, string>|null} Every invalid field with its message, or null.
 */
export function collectErrors(checks) {
  const errors = Object.fromEntries(Object.entries(checks).filter(([, message]) => message !== null));
  return Object.keys(errors).length > 0 ? errors : null;
}
