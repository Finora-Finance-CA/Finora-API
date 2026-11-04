import { describe, expect, it } from 'vitest';
import { expensesByMonth, trendRange } from '../../src/summary/trend.js';

describe('trendRange', () => {
  it('gives the 6 months ending at the given one, oldest first, and their date range', () => {
    expect(trendRange(2026, 11, 6)).toEqual({
      months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      start: '2026-06-01',
      end: '2026-12-01',
    });
  });

  it('crosses back into the previous year', () => {
    expect(trendRange(2027, 2, 6)).toEqual({
      months: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'],
      start: '2026-09-01',
      end: '2027-03-01',
    });
  });

  it('ends a December range on January 1st of the next year', () => {
    expect(trendRange(2026, 12, 1)).toEqual({ months: ['2026-12'], start: '2026-12-01', end: '2027-01-01' });
  });

  it('covers 24 months', () => {
    const { months, start, end } = trendRange(2026, 11, 24);
    expect(months).toHaveLength(24);
    expect(months[0]).toBe('2024-12');
    expect(start).toBe('2024-12-01');
    expect(end).toBe('2026-12-01');
  });
});

describe('expensesByMonth', () => {
  const MONTHS = ['2026-09', '2026-10', '2026-11'];

  it('adds up each month’s days, with 0 for a month with none', () => {
    expect(
      expensesByMonth(MONTHS, [
        { date: '2026-09-03', spent_cents: 1250 },
        { date: '2026-09-30', spent_cents: '8237' },
        { date: '2026-11-01', spent_cents: 50000 },
      ])
    ).toEqual([
      { month: '2026-09', expense_cents: 9487 },
      { month: '2026-10', expense_cents: 0 },
      { month: '2026-11', expense_cents: 50000 },
    ]);
  });

  it('gives every month 0 when there are no expenses', () => {
    expect(expensesByMonth(MONTHS, []).map(({ expense_cents }) => expense_cents)).toEqual([0, 0, 0]);
  });

  it('accepts dates as JS Dates, as pg may return them', () => {
    const result = expensesByMonth(MONTHS, [{ date: new Date(2026, 9, 31), spent_cents: 700 }]);
    expect(result[1]).toEqual({ month: '2026-10', expense_cents: 700 });
  });

  it('ignores days outside the months asked for', () => {
    const result = expensesByMonth(MONTHS, [{ date: '2026-08-31', spent_cents: 999 }]);
    expect(result.every(({ expense_cents }) => expense_cents === 0)).toBe(true);
  });
});
