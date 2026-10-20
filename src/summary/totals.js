// Monthly totals from the database's per-type sums (US-27, US-30). A pure function, so
// the arithmetic can be unit tested against hand-worked examples.

/**
 * pg returns SUM() and COUNT() of integers as BIGINT, which it sends as strings so no
 * precision is lost. Turns one into a Number, refusing anything that isn't a whole
 * number or that a Number can't hold exactly (beyond 2^53 - 1).
 *
 * @param {string|number|null|undefined} value
 * @returns {number}
 * @throws {RangeError} If the value isn't a safe whole number.
 */
export function toSafeInteger(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new RangeError(`Expected a safe whole number, got ${value}.`);
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new RangeError(`Expected a whole number, got ${JSON.stringify(value)}.`);
  }
  const big = BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Total ${value} is too large to return exactly.`);
  }
  return Number(big);
}

/**
 * @typedef {object} TotalsRow One row of the GROUP BY type query.
 * @property {'income'|'expense'} type
 * @property {string|number} total_cents SUM(amount_cents) for that type.
 * @property {string|number} transaction_count COUNT(*) for that type.
 */

/**
 * Totals for one month from its rows grouped by type. A type with no transactions has
 * no row, so a month with none at all is an empty array and gives all zeros.
 *
 * @param {TotalsRow[]} rows
 * @returns {{ income_cents: number, expense_cents: number, net_cents: number, transaction_count: number }}
 *   `net_cents` is income minus expenses, negative when more was spent than earned.
 * @throws {RangeError} For an unknown type or a total that can't be returned exactly.
 */
export function summarizeTotals(rows) {
  const totals = { income: 0, expense: 0 };
  let transactionCount = 0;

  for (const row of rows) {
    if (!(row.type in totals)) {
      throw new RangeError(`Unexpected transaction type ${JSON.stringify(row.type)}.`);
    }
    totals[row.type] = toSafeInteger(totals[row.type] + toSafeInteger(row.total_cents));
    transactionCount += toSafeInteger(row.transaction_count);
  }

  return {
    income_cents: totals.income,
    expense_cents: totals.expense,
    net_cents: toSafeInteger(totals.income - totals.expense),
    transaction_count: transactionCount,
  };
}
