// Expense totals for each of several months in a row (US-44). A pure function with no
// Express or database dependencies, so the numbers can be unit tested against
// hand-worked examples. The months themselves come from trendRange (validation.js).

import { toSafeInteger } from './totals.js';

/**
 * @typedef {object} DayTotal One row of expenseTotalsByDay.
 * @property {string} date YYYY-MM-DD (src/db.js makes pg return DATE columns as text).
 * @property {number|string} spent_cents
 */

/**
 * Each month's total expenses, in the order given, with 0 for a month with none.
 *
 * @param {string[]} months YYYY-MM, from trendRange.
 * @param {DayTotal[]} rows Expense totals per day. Days outside `months` are ignored.
 * @returns {{ month: string, expense_cents: number }[]}
 * @throws {RangeError} If a total isn't a safe whole number (see toSafeInteger).
 */
export function expensesByMonth(months, rows) {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const { date, spent_cents } of rows) {
    const month = date.slice(0, 7);
    if (!totals.has(month)) continue;
    totals.set(month, toSafeInteger(totals.get(month) + toSafeInteger(spent_cents)));
  }
  return months.map((month) => ({ month, expense_cents: totals.get(month) }));
}
