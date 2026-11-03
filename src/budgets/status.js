// Spending against each budget for one month (US-35). Pure functions with no Express
// or database dependencies, so the numbers can be unit tested against hand-worked
// examples (US-51).

import { BUDGET_CATEGORIES } from '../constants.js';
import { toSafeInteger } from '../summary/totals.js';

// From this share of its limit on, a category is close to going over (US-39).
export const WARNING_PERCENT = 80;

/**
 * @typedef {'under'|'warning'|'over'} BudgetState
 *   under: below 80% of the limit. warning: 80% up to and including 100%.
 *   over: more than the limit, by at least one cent.
 */

/**
 * How much of one limit has been spent. Whole numbers only, so the result is exact to
 * the cent and never depends on floating point.
 *
 * @param {number} limitCents The monthly limit, greater than 0.
 * @param {number} spentCents Spent in the month, 0 or more.
 * @returns {{ remaining_cents: number, percent_used: number, status: BudgetState }}
 *   `remaining_cents` is the limit minus what was spent, negative when over.
 *   `percent_used` is rounded down, so 79.9% is 79, and it goes past 100 when over.
 *   Over by one cent can still be 100, so use `status` to tell over from full.
 * @throws {RangeError} If either amount isn't a safe whole number in range, or the
 *   percentage is too large to return exactly.
 */
export function compareToLimit(limitCents, spentCents) {
  if (!Number.isSafeInteger(limitCents) || limitCents <= 0) {
    throw new RangeError(`Expected a limit above 0 cents, got ${limitCents}.`);
  }
  if (!Number.isSafeInteger(spentCents) || spentCents < 0) {
    throw new RangeError(`Expected 0 or more cents spent, got ${spentCents}.`);
  }

  // Math.floor(spent * 100 / limit), done in BigInt so spent * 100 stays exact even
  // past Number.MAX_SAFE_INTEGER. Neither is negative, so BigInt's division rounds down.
  const percent = (BigInt(spentCents) * 100n) / BigInt(limitCents);
  if (percent > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${spentCents} of ${limitCents} cents is too large a percentage to return exactly.`);
  }
  const percentUsed = Number(percent);

  // Rounded down, percentUsed reaches 80 exactly when spent * 100 >= limit * 80.
  let status = 'under';
  if (spentCents > limitCents) status = 'over';
  else if (percentUsed >= WARNING_PERCENT) status = 'warning';

  return { remaining_cents: limitCents - spentCents, percent_used: percentUsed, status };
}

/**
 * @typedef {object} CategorySpending One row of the expense totals per category.
 * @property {string} category
 * @property {number} spent_cents
 */

/**
 * @typedef {object} BudgetStatus
 * @property {string} id
 * @property {string} category
 * @property {number} limit_cents
 * @property {number} spent_cents
 * @property {number} remaining_cents
 * @property {number} percent_used
 * @property {BudgetState} status
 */

/**
 * Each budget with what was spent against it, in category order. A budget with no
 * spending has spent 0. Spending in a category without a budget is left out.
 *
 * @param {{ id: string, category: string, limit_cents: number }[]} budgets
 * @param {CategorySpending[]} spending A category with no expenses has no row. More
 *   than one row for a category is added up.
 * @returns {BudgetStatus[]}
 * @throws {RangeError} See compareToLimit and toSafeInteger.
 */
export function summarizeBudgets(budgets, spending) {
  const spentByCategory = new Map();
  for (const { category, spent_cents } of spending) {
    const total = (spentByCategory.get(category) ?? 0) + toSafeInteger(spent_cents);
    spentByCategory.set(category, toSafeInteger(total));
  }

  const categoryOrder = (budget) => BUDGET_CATEGORIES.indexOf(budget.category);
  return [...budgets]
    .sort((a, b) => categoryOrder(a) - categoryOrder(b))
    .map(({ id, category, limit_cents }) => {
      const spent_cents = spentByCategory.get(category) ?? 0;
      return { id, category, limit_cents, spent_cents, ...compareToLimit(limit_cents, spent_cents) };
    });
}
