// Validation for GET /api/summary?month=YYYY-MM. Pure functions with no Express or
// database dependencies.

import { MIN_YEAR } from '../constants.js';

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MONTH_FORMAT = 'month must be a real month in YYYY-MM format, e.g. 2026-10.';

const pad = (number, width) => String(number).padStart(width, '0');

/**
 * The first day of a month and the first day of the next one, both YYYY-MM-DD. Worked
 * out from the text with whole numbers only, never a JS Date, so no time zone can move
 * a boundary by a day.
 *
 * @param {number} year
 * @param {number} month 1 to 12.
 * @returns {{ start: string, end: string }} `end` is exclusive: date >= start AND date < end.
 */
export function monthRange(year, month) {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${pad(year, 4)}-${pad(month, 2)}-01`,
    end: `${pad(nextYear, 4)}-${pad(nextMonth, 2)}-01`,
  };
}

/**
 * @typedef {object} SummaryQuery
 * @property {string} month YYYY-MM, as given.
 * @property {string} start First day of the month, YYYY-MM-DD.
 * @property {string} end First day of the next month, YYYY-MM-DD (exclusive).
 */

/**
 * Validates the query string of GET /api/summary. `month` is required: the server
 * can't know the user's time zone, so it never guesses which month is "this month".
 *
 * @param {Record<string, unknown>} [query] The parsed query string (req.query).
 * @returns {{ errors: Record<string, string> } | { errors: null, value: SummaryQuery }}
 */
export function validateSummaryQuery(query = {}) {
  const { month } = query;
  if (month === undefined || month === '') {
    return { errors: { month: 'month is required, in YYYY-MM format, e.g. 2026-10.' } };
  }
  if (Array.isArray(month)) {
    return { errors: { month: 'month must be given only once.' } };
  }

  const match = typeof month === 'string' ? MONTH_PATTERN.exec(month) : null;
  const [year, monthNumber] = match ? match.slice(1).map(Number) : [];
  if (!match || monthNumber < 1 || monthNumber > 12) {
    return { errors: { month: MONTH_FORMAT } };
  }
  if (year < MIN_YEAR) {
    return { errors: { month: `month must be in ${MIN_YEAR} or later.` } };
  }

  return { errors: null, value: { month, ...monthRange(year, monthNumber) } };
}
