// US-62: the 1,000 transactions npm run seed:perf gives the demo user.

import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../src/constants.js';
import { validateTransactionBody } from '../../src/transactions/validation.js';
import {
  PERF_CREATED_AT_END,
  PERF_CREATED_AT_START,
  PERF_TRANSACTION_COUNT,
  generatePerfTransactions,
  seededRandom,
} from '../../scripts/seed/perfTransactions.js';

const TODAY = '2026-11-16';
const rows = generatePerfTransactions(TODAY);

describe('generatePerfTransactions', () => {
  it('makes exactly 1,000 transactions', () => {
    expect(PERF_TRANSACTION_COUNT).toBe(1000);
    expect(rows).toHaveLength(1000);
  });

  it('dates them over the 12 months up to today, with some in every one of those months', () => {
    const dates = rows.map((row) => row.date);
    expect(dates.every((date) => date > '2025-11-16' && date <= TODAY)).toBe(true);
    const months = new Set(dates.map((date) => date.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(12);
    for (const month of ['2025-12', '2026-03', '2026-06', '2026-09', '2026-11']) expect(months.has(month)).toBe(true);
  });

  it('covers every category, with incomes and expenses', () => {
    const expenses = rows.filter((row) => row.type === 'expense');
    const incomes = rows.filter((row) => row.type === 'income');
    expect(new Set(expenses.map((row) => row.category))).toEqual(new Set(CATEGORIES));
    expect(incomes.length).toBeGreaterThanOrEqual(24);
    expect(incomes.every((row) => row.category === null)).toBe(true);
    expect(expenses.length).toBeGreaterThan(incomes.length * 10);
  });

  it('pays the rent once a month', () => {
    const rentMonths = rows.filter((row) => row.description === 'Rent').map((row) => row.date.slice(0, 7));
    expect(rentMonths).toHaveLength(12);
  });

  it('only holds transactions a user could have entered through the API', () => {
    for (const row of rows) {
      const { created_at, ...body } = row;
      expect(validateTransactionBody(body).errors, JSON.stringify(row)).toBeNull();
      expect(Number.isInteger(row.amount_cents)).toBe(true);
      expect(created_at >= PERF_CREATED_AT_START && created_at < PERF_CREATED_AT_END).toBe(true);
    }
  });

  it('marks each row with its own created_at, inside the perf window', () => {
    expect(new Set(rows.map((row) => row.created_at)).size).toBe(1000);
  });

  it('is the same set every time for the same day, so timings can be compared', () => {
    expect(generatePerfTransactions(TODAY)).toEqual(rows);
    expect(generatePerfTransactions(TODAY, 7)).not.toEqual(rows);
  });

  it('lists the newest first', () => {
    const dates = rows.map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it.each(['2026-02-30', '16-11-2026', '', undefined])('refuses a bad today %j', (today) => {
    expect(() => generatePerfTransactions(today)).toThrow(TypeError);
  });

  it('works across a leap day', () => {
    expect(generatePerfTransactions('2028-02-29')).toHaveLength(1000);
  });
});

describe('seededRandom', () => {
  it('gives the same numbers for the same seed, between 0 and 1', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
