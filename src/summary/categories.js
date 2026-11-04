// Expense totals for every category in one month (US-43). Pure functions with no
// Express or database dependencies, so the numbers can be unit tested against
// hand-worked examples.

import { BUDGET_CATEGORIES } from '../constants.js';
import { toSafeInteger } from './totals.js';

/**
 * @typedef {object} CategoryTotal
 * @property {string} category
 * @property {number} spent_cents
 */

/**
 * Every expense category with what was spent in it, in the usual category order, with
 * 0 where nothing was spent, plus the total. The front-end never has to tell a missing
 * category apart from an empty one, and colours stay the same from month to month.
 *
 * @param {import('../budgets/status.js').CategorySpending[]} rows From
 *   expenseTotalsByCategory. A category with no expenses has no row; more than one row
 *   for a category is added up. A category not in the usual list (there shouldn't be
 *   one) is kept, after the others, so the total always matches the month's expenses.
 * @returns {{ total_cents: number, categories: CategoryTotal[] }}
 * @throws {RangeError} If an amount isn't a safe whole number (see toSafeInteger).
 */
export function spendingByCategory(rows) {
  const spent = new Map(BUDGET_CATEGORIES.map((category) => [category, 0]));
  for (const { category, spent_cents } of rows) {
    const total = (spent.get(category) ?? 0) + toSafeInteger(spent_cents);
    spent.set(category, toSafeInteger(total));
  }

  const categories = [...spent].map(([category, spent_cents]) => ({ category, spent_cents }));
  const total_cents = toSafeInteger(categories.reduce((sum, { spent_cents }) => sum + spent_cents, 0));
  return { total_cents, categories };
}