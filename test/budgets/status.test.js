// US-35: spending against each budget, checked against hand-worked examples. US-51
// adds to these.

import { describe, expect, it } from 'vitest';
import { compareToLimit, summarizeBudgets, WARNING_PERCENT } from '../../src/budgets/status.js';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';

describe('compareToLimit', () => {
  it.each([
    // [case, limit, spent, remaining, percent, status]
    ['nothing spent', 50000, 0, 50000, 0, 'under'],
    ['79%', 10000, 7900, 2100, 79, 'under'],
    ['exactly 80%', 10000, 8000, 2000, 80, 'warning'],
    ['99%', 10000, 9900, 100, 99, 'warning'],
    ['exactly 100%', 10000, 10000, 0, 100, 'warning'],
    ['101%', 10000, 10100, -100, 101, 'over'],
  ])('%s: limit %i, spent %i', (_, limit, spent, remaining_cents, percent_used, status) => {
    expect(compareToLimit(limit, spent)).toEqual({ remaining_cents, percent_used, status });
  });

  it('rounds the percentage down', () => {
    // $2.39 of $3.00 is 79.67%, shown as 79 and still under. $2.40 is exactly 80%.
    expect(compareToLimit(300, 239)).toEqual({ remaining_cents: 61, percent_used: 79, status: 'under' });
    expect(compareToLimit(300, 240)).toEqual({ remaining_cents: 60, percent_used: 80, status: 'warning' });
  });

  it('is over at one cent past the limit, even though the percentage rounds down to 100', () => {
    // $100.01 of $100.00 is 100.01%.
    expect(compareToLimit(10000, 10001)).toEqual({ remaining_cents: -1, percent_used: 100, status: 'over' });
  });

  it('works through a hand-worked month', () => {
    // Food limit $500.00. Lunch $12.50 + groceries $82.37 + groceries $310.00 = $404.87.
    // $404.87 / $500.00 = 80.97%, so 80, a warning. $500.00 - $404.87 = $95.13 left.
    expect(compareToLimit(50000, 40487)).toEqual({ remaining_cents: 9513, percent_used: 80, status: 'warning' });
  });

  it('starts the warning at WARNING_PERCENT', () => {
    expect(WARNING_PERCENT).toBe(80);
  });

  it('handles spending far beyond the largest limit', () => {
    // Five expenses of the largest amount, $21,474,836.47 each, against that same limit.
    expect(compareToLimit(MAX_AMOUNT_CENTS, 5 * MAX_AMOUNT_CENTS)).toEqual({
      remaining_cents: -8_589_934_588,
      percent_used: 500,
      status: 'over',
    });
  });

  it('stays exact where floating point would round the percentage up', () => {
    // 1286742750677284 * 100 / 15 = 8578285004515226 remainder 10. Math.floor on
    // floating point division gives 8578285004515227.
    expect(compareToLimit(15, 1_286_742_750_677_284).percent_used).toBe(8_578_285_004_515_226);
  });

  it('refuses a percentage too large to return exactly', () => {
    expect(() => compareToLimit(1, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it.each([0, -100, 12.5, NaN, '10000', null])('refuses the limit %j', (limit) => {
    expect(() => compareToLimit(limit, 0)).toThrow(RangeError);
  });

  it.each([-1, 0.5, NaN, '0', null, Number.MAX_SAFE_INTEGER + 1])('refuses the amount spent %j', (spent) => {
    expect(() => compareToLimit(10000, spent)).toThrow(RangeError);
  });
});

describe('summarizeBudgets', () => {
  const budget = (id, category, limit_cents) => ({ id, category, limit_cents });
  const spent = (category, spent_cents) => ({ category, spent_cents });

  it('returns an empty list when there are no budgets, whatever was spent', () => {
    expect(summarizeBudgets([], [])).toEqual([]);
    expect(summarizeBudgets([], [spent('Food', 1250)])).toEqual([]);
  });

  it('gives a budget with no spending 0 spent and its whole limit left', () => {
    expect(summarizeBudgets([budget('3', 'Entertainment', 10000)], [])).toEqual([
      { id: '3', category: 'Entertainment', limit_cents: 10000, spent_cents: 0, remaining_cents: 10000, percent_used: 0, status: 'under' },
    ]);
  });

  it('matches spending to each budget by category, in category order', () => {
    // Food $404.87 of $500.00. Transportation $45.00 + $128.15 = $173.15 of $150.00, so
    // $23.15 over at 115%. Housing $1,800.00 of $1,800.00. Entertainment nothing.
    const budgets = [
      budget('4', 'Entertainment', 10000),
      budget('2', 'Housing', 180000),
      budget('9', 'Food', 50000),
      budget('5', 'Transportation', 15000),
    ];
    const spending = [spent('Housing', 180000), spent('Food', 40487), spent('Transportation', 17315)];

    expect(summarizeBudgets(budgets, spending)).toEqual([
      { id: '9', category: 'Food', limit_cents: 50000, spent_cents: 40487, remaining_cents: 9513, percent_used: 80, status: 'warning' },
      { id: '5', category: 'Transportation', limit_cents: 15000, spent_cents: 17315, remaining_cents: -2315, percent_used: 115, status: 'over' },
      { id: '2', category: 'Housing', limit_cents: 180000, spent_cents: 180000, remaining_cents: 0, percent_used: 100, status: 'warning' },
      { id: '4', category: 'Entertainment', limit_cents: 10000, spent_cents: 0, remaining_cents: 10000, percent_used: 0, status: 'under' },
    ]);
  });

  it('leaves out spending in a category without a budget', () => {
    const result = summarizeBudgets([budget('1', 'Food', 50000)], [spent('Other', 99999), spent('Food', 100)]);

    expect(result.map((item) => item.category)).toEqual(['Food']);
    expect(result[0].spent_cents).toBe(100);
  });

  it('returns only the status fields, never the owner or timestamps', () => {
    const stored = { ...budget('1', 'Food', 50000), user_id: 'someone', created_at: 'x', updated_at: 'y' };

    expect(Object.keys(summarizeBudgets([stored], [])[0]).sort()).toEqual(
      ['category', 'id', 'limit_cents', 'percent_used', 'remaining_cents', 'spent_cents', 'status'].sort()
    );
  });

  it('adds up more than one row for the same category, and reads pg BIGINT strings', () => {
    const [food] = summarizeBudgets([budget('1', 'Food', 1000)], [spent('Food', '250'), spent('Food', 600)]);

    expect(food).toMatchObject({ spent_cents: 850, remaining_cents: 150, percent_used: 85, status: 'warning' });
  });

  it('refuses a total that a JavaScript number cannot hold exactly', () => {
    expect(() => summarizeBudgets([budget('1', 'Food', 1000)], [spent('Food', '9007199254740992')])).toThrow(RangeError);
  });
});
