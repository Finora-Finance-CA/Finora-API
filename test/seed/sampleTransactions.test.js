import { describe, expect, it } from 'vitest';
import {
  generateSampleTransactions,
  localDateString,
  SAMPLE_HISTORY_DAYS,
  SAMPLE_PROFILES,
} from '../../scripts/seed/sampleTransactions.js';
import { CATEGORIES, validateTransactionBody } from '../../src/transactions/validation.js';

const TODAY = '2026-10-06';
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(earlier, later) {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS;
}

describe.each(SAMPLE_PROFILES.map((_, index) => index))('sample user %i', (profileIndex) => {
  const transactions = generateSampleTransactions(profileIndex, TODAY);

  it('has at least 20 transactions', () => {
    expect(transactions.length).toBeGreaterThanOrEqual(20);
  });

  it('covers every expense category', () => {
    const categories = new Set(transactions.filter((t) => t.type === 'expense').map((t) => t.category));
    expect([...categories].sort()).toEqual([...CATEGORIES].sort());
  });

  it('includes both income and expenses', () => {
    expect(new Set(transactions.map((t) => t.type))).toEqual(new Set(['income', 'expense']));
  });

  it('only has positive whole-number amounts in cents', () => {
    for (const { amount_cents } of transactions) {
      expect(Number.isInteger(amount_cents)).toBe(true);
      expect(amount_cents).toBeGreaterThan(0);
    }
  });

  it('dates every transaction within the last three months, up to today', () => {
    for (const { date } of transactions) {
      const age = daysBetween(date, TODAY);
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(SAMPLE_HISTORY_DAYS);
    }
  });

  it('passes the API’s own validation for every transaction', () => {
    for (const transaction of transactions) {
      expect(validateTransactionBody(transaction).errors).toBeNull();
    }
  });

  it('lists the newest first', () => {
    const dates = transactions.map((t) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('gives the same result every time for the same day', () => {
    expect(generateSampleTransactions(profileIndex, TODAY)).toEqual(transactions);
  });
});

describe('generateSampleTransactions', () => {
  it('gives each sample user different data', () => {
    expect(generateSampleTransactions(0, TODAY)).not.toEqual(generateSampleTransactions(1, TODAY));
  });

  it('dates rows correctly across a year boundary', () => {
    const dates = generateSampleTransactions(0, '2028-01-10').map((t) => t.date);

    expect(dates.some((date) => date.startsWith('2028-01'))).toBe(true);
    expect(dates.some((date) => date.startsWith('2027-12'))).toBe(true);
    expect(dates.some((date) => date.startsWith('2027-10'))).toBe(true);
    for (const date of dates) {
      expect(daysBetween(date, '2028-01-10')).toBeLessThan(SAMPLE_HISTORY_DAYS);
      expect(validateTransactionBody({ amount_cents: 1, date, type: 'income' }).errors).toBeNull();
    }
  });

  it('moves every date forward when today moves forward', () => {
    const today = generateSampleTransactions(1, '2026-10-06');
    const tomorrow = generateSampleTransactions(1, '2026-10-07');

    tomorrow.forEach((row, i) => expect(daysBetween(today[i].date, row.date)).toBe(1));
  });

  it.each([-1, 2, 1.5, undefined])('rejects the profile index %s', (index) => {
    expect(() => generateSampleTransactions(index, TODAY)).toThrow(RangeError);
  });

  it.each(['2026-02-30', '2026/10/06', '', undefined])('rejects the date %s', (today) => {
    expect(() => generateSampleTransactions(0, today)).toThrow(TypeError);
  });
});

describe('localDateString', () => {
  it('formats the local calendar date, not the UTC one', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
