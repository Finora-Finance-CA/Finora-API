// Expense totals for each of several months in a row (US-44). Pure functions with no
// Express or database dependencies, so the numbers can be unit tested against
// hand-worked examples.

import { toSafeInteger } from './totals.js';
import { monthRange } from './validation.js';

const pad = (number, width) => String(number).padStart(width, '0');

/**
 * The `count` months ending at (and including) year-month, oldest first, and the date
 * range covering them all. Whole numbers only, never a JS Date, like monthRange.
 *
 * @param {number} year
 * @param {number} month 1 to 12.
 * @param {number} count How many months, 1 or more.
 * @returns {{ months: string[], start: string, end: string }} months as YYYY-MM;
 *   start is the first day of the first month, end the first day after the last
 *   (exclusive), as for monthRange.
 */
export function trendRange(year, month, count) {
  // Months since year 0, so stepping back across a new year is plain subtraction.
  const last = year * 12 + (month - 1);
  const months = [];
  for (let index = last - count + 1; index <= last; index += 1) {
    months.push(`${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}`);
  }

  const [firstYear, firstMonth] = months[0].split('-').map(Number);
  return { months, start: monthRange(firstYear, firstMonth).start, end: monthRange(year, month).end };
}

// "2026-10" from a DATE: a YYYY-MM-DD string, or a Date if pg parses DATE columns
// (pg makes it midnight local time, so the local getters give the right day).
function monthOf(date) {
  if (date instanceof Date) return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}`;
  return String(date).slice(0, 7);
}

/**
 * @typedef {object} DayTotal One row of expenseTotalsByDay.
 * @property {string|Date} date
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
    const month = monthOf(date);
    if (!totals.has(month)) continue;
    totals.set(month, toSafeInteger(totals.get(month) + toSafeInteger(spent_cents)));
  }
  return months.map((month) => ({ month, expense_cents: totals.get(month) }));
}
