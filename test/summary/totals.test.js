// US-30: monthly totals checked against hand-worked examples. The rows are what the
// GROUP BY type query returns: pg sends SUM and COUNT as BIGINT strings.

import { describe, expect, it } from 'vitest';
import { summarizeTotals, toSafeInteger } from '../../src/summary/totals.js';

const income = (total_cents, transaction_count) => ({ type: 'income', total_cents, transaction_count });
const expense = (total_cents, transaction_count) => ({ type: 'expense', total_cents, transaction_count });

describe('summarizeTotals', () => {
  it('gives all zeros for a month with no transactions', () => {
    expect(summarizeTotals([])).toEqual({ income_cents: 0, expense_cents: 0, net_cents: 0, transaction_count: 0 });
  });

  it('handles a month with only income', () => {
    // Two paycheques: $1,250.00 + $1,250.00 = $2,500.00.
    expect(summarizeTotals([income('250000', '2')])).toEqual({
      income_cents: 250000,
      expense_cents: 0,
      net_cents: 250000,
      transaction_count: 2,
    });
  });

  it('handles a month with only expenses, giving a negative net', () => {
    // Lunch $12.50 + rent $950.00 + transit pass $128.15 = $1,090.65.
    expect(summarizeTotals([expense('109065', '3')])).toEqual({
      income_cents: 0,
      expense_cents: 109065,
      net_cents: -109065,
      transaction_count: 3,
    });
  });

  it('subtracts expenses from income', () => {
    // Salary $2,450.00. Rent $1,825.00 + groceries $112.36 + gas $61.50 = $1,998.86.
    // Net: $2,450.00 - $1,998.86 = $451.14.
    expect(summarizeTotals([income('245000', '1'), expense('199886', '3')])).toEqual({
      income_cents: 245000,
      expense_cents: 199886,
      net_cents: 45114,
      transaction_count: 4,
    });
  });

  it('gives a negative net when more was spent than earned', () => {
    // Paycheque $685.40. Rent share $850.00 + transit $128.15 + groceries $64.23 = $1,042.38.
    // Net: $685.40 - $1,042.38 = -$356.98.
    expect(summarizeTotals([expense('104238', '3'), income('68540', '1')])).toEqual({
      income_cents: 68540,
      expense_cents: 104238,
      net_cents: -35698,
      transaction_count: 4,
    });
  });

  it('is exact to the cent, with no floating point error', () => {
    // $0.10 + $0.20 is $0.30 exactly, which floating point dollars (0.1 + 0.2) are not.
    expect(summarizeTotals([income('30', '2'), expense('10', '1')]).net_cents).toBe(20);
  });

  it('accepts numbers as well as strings', () => {
    expect(summarizeTotals([income(500, 1), expense(200, 1)])).toMatchObject({ net_cents: 300, transaction_count: 2 });
  });

  it('adds up more than one row for the same type', () => {
    expect(summarizeTotals([expense('100', '1'), expense('250', '2')])).toMatchObject({
      expense_cents: 350,
      transaction_count: 3,
    });
  });

  it('handles totals far beyond what one INTEGER amount can hold', () => {
    // Five transactions of the largest amount, $21,474,836.47 each.
    expect(summarizeTotals([income('10737418235', '5')]).income_cents).toBe(10_737_418_235);
  });

  it('refuses an unknown type instead of ignoring it', () => {
    expect(() => summarizeTotals([{ type: 'transfer', total_cents: '1', transaction_count: '1' }])).toThrow(RangeError);
  });

  it('refuses a total that a JavaScript number cannot hold exactly', () => {
    expect(() => summarizeTotals([income('9007199254740992', '1')])).toThrow(RangeError);
    expect(() => summarizeTotals([income('4503599627370496', '1'), income('4503599627370496', '1')])).toThrow(
      RangeError
    );
  });
});

describe('toSafeInteger', () => {
  it.each([
    ['0', 0],
    ['-35698', -35698],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    [42, 42],
    [null, 0],
    [undefined, 0],
  ])('reads %j as %j', (value, expected) => {
    expect(toSafeInteger(value)).toBe(expected);
  });

  it.each(['12.5', '1e3', '', 'abc', ' 1', 12.5, NaN, '9007199254740992', {}])('rejects %j', (value) => {
    expect(() => toSafeInteger(value)).toThrow(RangeError);
  });
});
