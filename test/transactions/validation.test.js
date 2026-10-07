import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_CENTS,
  MAX_DESCRIPTION_LENGTH,
  validateTransactionBody,
  validateTransactionId,
} from '../../src/transactions/validation.js';

const VALID_EXPENSE = { amount_cents: 1250, date: '2026-10-05', type: 'expense', category: 'Food', description: 'Lunch' };
const VALID_INCOME = { amount_cents: 200000, date: '2026-10-01', type: 'income' };

function errorsFor(changes) {
  return validateTransactionBody({ ...VALID_EXPENSE, ...changes }).errors;
}

describe('validateTransactionBody', () => {
  it('accepts a valid expense and returns the cleaned values', () => {
    expect(validateTransactionBody(VALID_EXPENSE)).toEqual({ errors: null, value: VALID_EXPENSE });
  });

  it('accepts an income without a category and stores the category as null', () => {
    expect(validateTransactionBody(VALID_INCOME)).toEqual({
      errors: null,
      value: { ...VALID_INCOME, category: null, description: null },
    });
  });

  it('keeps a valid category on an income', () => {
    expect(validateTransactionBody({ ...VALID_INCOME, category: 'Other' }).value.category).toBe('Other');
  });

  it('reports every missing required field at once', () => {
    expect(validateTransactionBody({}).errors).toEqual({
      amount_cents: 'amount_cents is required.',
      date: 'date is required.',
      type: 'type is required.',
    });
  });

  it.each([
    ['null', null],
    ['an array', [VALID_EXPENSE]],
    ['a string', 'amount_cents=1250'],
    ['undefined (no JSON body)', undefined],
  ])('rejects a body that is %s', (_, body) => {
    expect(validateTransactionBody(body).errors).toEqual({
      body: 'Request body must be a JSON object. Set Content-Type: application/json.',
    });
  });

  it('ignores fields it does not know, including id and user_id', () => {
    const { value } = validateTransactionBody({ ...VALID_EXPENSE, id: '7', user_id: 'someone-else', extra: true });
    expect(value).toEqual(VALID_EXPENSE);
  });

  describe('amount_cents', () => {
    it.each([
      ['zero', 0, 'amount_cents must be greater than zero.'],
      ['negative', -500, 'amount_cents must be greater than zero.'],
      ['a decimal', 12.5, 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
      ['a numeric string', '1250', 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
      ['a non-numeric string', 'twelve', 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
      ['a boolean', true, 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
      ['one more than the column holds', MAX_AMOUNT_CENTS + 1, `amount_cents must be at most ${MAX_AMOUNT_CENTS}.`],
      ['an empty string', '', 'amount_cents is required.'],
    ])('rejects %s', (_, amount_cents, message) => {
      expect(errorsFor({ amount_cents })).toEqual({ amount_cents: message });
    });

    it.each([1, MAX_AMOUNT_CENTS])('accepts %i', (amount_cents) => {
      expect(errorsFor({ amount_cents })).toBeNull();
    });
  });

  describe('date', () => {
    it.each([
      ['month 13', '2026-13-01', 'date must be a real calendar date.'],
      ['February 30th', '2026-02-30', 'date must be a real calendar date.'],
      ['February 29th outside a leap year', '2025-02-29', 'date must be a real calendar date.'],
      ['day zero', '2026-10-00', 'date must be a real calendar date.'],
      ['slashes', '2026/10/05', 'date must be a string in YYYY-MM-DD format.'],
      ['day-month-year order', '05-10-2026', 'date must be a string in YYYY-MM-DD format.'],
      ['a timestamp', '2026-10-05T12:00:00Z', 'date must be a string in YYYY-MM-DD format.'],
      ['a number', 20261005, 'date must be a string in YYYY-MM-DD format.'],
      ['a year before 1900', '1899-12-31', 'date must be in 1900 or later.'],
    ])('rejects %s', (_, date, message) => {
      expect(errorsFor({ date })).toEqual({ date: message });
    });

    it.each(['2024-02-29', '1900-01-01'])('accepts %s', (date) => {
      expect(errorsFor({ date })).toBeNull();
    });
  });

  describe('type', () => {
    it.each(['transfer', 'Expense', 'INCOME'])('rejects %s', (type) => {
      expect(errorsFor({ type })).toEqual({ type: 'type must be one of: income, expense.' });
    });
  });

  describe('category', () => {
    it.each(['Groceries', 'food', 'FOOD'])('rejects the unknown category %s', (category) => {
      expect(errorsFor({ category })).toEqual({
        category: 'category must be one of: Food, Transportation, Housing, Entertainment, Other.',
      });
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
    ])('requires a category on an expense when it is %s', (_, category) => {
      expect(errorsFor({ category })).toEqual({ category: 'category is required for an expense.' });
    });

    it.each(['Food', 'Transportation', 'Housing', 'Entertainment', 'Other'])('accepts %s', (category) => {
      expect(errorsFor({ category })).toBeNull();
    });
  });

  describe('description', () => {
    it('rejects one character over the limit', () => {
      expect(errorsFor({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) })).toEqual({
        description: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      });
    });

    it('accepts exactly the limit, ignoring surrounding spaces', () => {
      const description = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
      expect(validateTransactionBody({ ...VALID_EXPENSE, description: `  ${description}  ` }).value.description).toBe(
        description
      );
    });

    it('rejects a non-string description', () => {
      expect(errorsFor({ description: 42 })).toEqual({ description: 'description must be a string.' });
    });

    it.each([
      ['blank', '   '],
      ['null', null],
    ])('stores a %s description as null', (_, description) => {
      expect(validateTransactionBody({ ...VALID_EXPENSE, description }).value.description).toBeNull();
    });
  });
});

describe('validateTransactionId', () => {
  it.each(['1', '42', '9223372036854775807'])('accepts %s', (id) => {
    expect(validateTransactionId(id)).toBeNull();
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['a decimal', '1.5'],
    ['a leading zero', '01'],
    ['letters', 'abc'],
    ['an exponent', '1e3'],
    ['surrounding spaces', ' 1'],
    ['empty', ''],
    ['beyond BIGINT', '9223372036854775808'],
    ['a number instead of a string', 1],
    ['missing', undefined],
  ])('rejects %s', (_, id) => {
    expect(validateTransactionId(id)).toBe('id must be a positive whole number.');
  });
});
