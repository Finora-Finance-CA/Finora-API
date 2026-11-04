import { describe, expect, it } from 'vitest';
import { spendingByCategory } from '../../src/summary/categories.js';

describe('spendingByCategory', () => {
  it('lists every category in order, with 0 where nothing was spent', () => {
    expect(spendingByCategory([
      { category: 'Housing', spent_cents: 45000 },
      { category: 'Food', spent_cents: 1250 },
    ])).toEqual({
      total_cents: 46250,
      categories: [
        { category: 'Food', spent_cents: 1250 },
        { category: 'Transportation', spent_cents: 0 },
        { category: 'Housing', spent_cents: 45000 },
        { category: 'Entertainment', spent_cents: 0 },
        { category: 'Other', spent_cents: 0 },
      ],
    });
  });

  it('gives every category 0 and a total of 0 for a month with no expenses', () => {
    const result = spendingByCategory([]);

    expect(result.total_cents).toBe(0);
    expect(result.categories).toHaveLength(5);
    expect(result.categories.every(({ spent_cents }) => spent_cents === 0)).toBe(true);
  });

  it('adds up more than one row for the same category', () => {
    const result = spendingByCategory([
      { category: 'Food', spent_cents: 1250 },
      { category: 'Food', spent_cents: 8237 },
    ]);

    expect(result.categories[0]).toEqual({ category: 'Food', spent_cents: 9487 });
    expect(result.total_cents).toBe(9487);
  });

  it('accepts totals as strings, the way pg returns BIGINT', () => {
    const result = spendingByCategory([{ category: 'Other', spent_cents: '2599' }]);

    expect(result.categories[4]).toEqual({ category: 'Other', spent_cents: 2599 });
  });

  it('keeps an unexpected category after the others, so the total still matches', () => {
    const result = spendingByCategory([{ category: 'Mystery', spent_cents: 100 }]);

    expect(result.categories.at(-1)).toEqual({ category: 'Mystery', spent_cents: 100 });
    expect(result.total_cents).toBe(100);
  });
});
