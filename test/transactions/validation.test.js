import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  validateListQuery,
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
      amount_cents: 'Amount is required.',
      date: 'Date is required.',
      type: 'Type is required.',
    });
  });

  it.each([
    ['null', null],
    ['an array', [VALID_EXPENSE]],
    ['a string', 'amount_cents=1250'],
    ['undefined (no JSON body)', undefined],
  ])('rejects a body that is %s', (_, body) => {
    expect(validateTransactionBody(body).errors).toEqual({
      body: 'Request body must be a JSON object.',
    });
  });

  it('ignores fields it does not know, including id and user_id', () => {
    const { value } = validateTransactionBody({ ...VALID_EXPENSE, id: '7', user_id: 'someone-else', extra: true });
    expect(value).toEqual(VALID_EXPENSE);
  });

  describe('amount_cents', () => {
    it.each([
      ['zero', 0, 'Amount must be greater than 0.'],
      ['negative', -500, 'Amount must be greater than 0.'],
      ['a decimal', 12.5, 'Amount must be a whole number of cents, for example 1250 for $12.50.'],
      ['a numeric string', '1250', 'Amount must be a whole number of cents, for example 1250 for $12.50.'],
      ['a non-numeric string', 'twelve', 'Amount must be a whole number of cents, for example 1250 for $12.50.'],
      ['a boolean', true, 'Amount must be a whole number of cents, for example 1250 for $12.50.'],
      ['one more than the column holds', MAX_AMOUNT_CENTS + 1, 'Amount must be $21,474,836.47 or less.'],
      ['an empty string', '', 'Amount is required.'],
    ])('rejects %s', (_, amount_cents, message) => {
      expect(errorsFor({ amount_cents })).toEqual({ amount_cents: message });
    });

    it.each([1, MAX_AMOUNT_CENTS])('accepts %i', (amount_cents) => {
      expect(errorsFor({ amount_cents })).toBeNull();
    });
  });

  describe('date', () => {
    it.each([
      ['month 13', '2026-13-01', 'Date must be a real calendar date.'],
      ['February 30th', '2026-02-30', 'Date must be a real calendar date.'],
      ['February 29th outside a leap year', '2025-02-29', 'Date must be a real calendar date.'],
      ['day zero', '2026-10-00', 'Date must be a real calendar date.'],
      ['slashes', '2026/10/05', 'Date must be in YYYY-MM-DD format, for example 2026-10-05.'],
      ['day-month-year order', '05-10-2026', 'Date must be in YYYY-MM-DD format, for example 2026-10-05.'],
      ['a timestamp', '2026-10-05T12:00:00Z', 'Date must be in YYYY-MM-DD format, for example 2026-10-05.'],
      ['a number', 20261005, 'Date must be in YYYY-MM-DD format, for example 2026-10-05.'],
      ['a year before 1900', '1899-12-31', 'Date must be between 1900-01-01 and 2100-12-31.'],
    ])('rejects %s', (_, date, message) => {
      expect(errorsFor({ date })).toEqual({ date: message });
    });

    it.each(['2024-02-29', '1900-01-01'])('accepts %s', (date) => {
      expect(errorsFor({ date })).toBeNull();
    });
  });

  describe('type', () => {
    it.each(['transfer', 'Expense', 'INCOME'])('rejects %s', (type) => {
      expect(errorsFor({ type })).toEqual({ type: 'Type must be income or expense.' });
    });
  });

  describe('category', () => {
    it.each(['Groceries', 'food', 'FOOD'])('rejects the unknown category %s', (category) => {
      expect(errorsFor({ category })).toEqual({
        category: 'Category must be one of Food, Transportation, Housing, Entertainment or Other.',
      });
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
    ])('requires a category on an expense when it is %s', (_, category) => {
      expect(errorsFor({ category })).toEqual({ category: 'Category is required for an expense.' });
    });

    it.each(['Food', 'Transportation', 'Housing', 'Entertainment', 'Other'])('accepts %s', (category) => {
      expect(errorsFor({ category })).toBeNull();
    });
  });

  describe('description', () => {
    it('rejects one character over the limit', () => {
      expect(errorsFor({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) })).toEqual({
        description: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
      });
    });

    it('accepts exactly the limit, ignoring surrounding spaces', () => {
      const description = 'x'.repeat(MAX_DESCRIPTION_LENGTH);
      expect(validateTransactionBody({ ...VALID_EXPENSE, description: `  ${description}  ` }).value.description).toBe(
        description
      );
    });

    it('rejects a non-string description', () => {
      expect(errorsFor({ description: 42 })).toEqual({ description: 'Description must be text.' });
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
    expect(validateTransactionId(id)).toBe('ID must be a positive whole number.');
  });
});

describe('validateListQuery', () => {
  const NO_FILTERS = { page: 1, q: null, categories: [], from: null, to: null };

  it('defaults to the first page with no filters', () => {
    expect(validateListQuery({})).toEqual({ errors: null, value: NO_FILTERS });
    expect(validateListQuery()).toEqual({ errors: null, value: NO_FILTERS });
  });

  it('returns cleaned values for every filter', () => {
    expect(
      validateListQuery({ page: '3', q: '  Lunch ', category: ['Housing', 'Food', 'Food'], from: '2026-09-01', to: '2026-09-30' })
    ).toEqual({
      errors: null,
      value: { page: 3, q: 'Lunch', categories: ['Food', 'Housing'], from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('accepts a single category as a string', () => {
    expect(validateListQuery({ category: 'Other' }).value.categories).toEqual(['Other']);
  });

  it.each([
    ['an empty page', { page: '' }],
    ['an empty search', { q: '' }],
    ['a blank search', { q: '   ' }],
    ['an empty category', { category: '' }],
    ['empty dates', { from: '', to: '' }],
  ])('treats %s as not given', (_, query) => {
    expect(validateListQuery(query)).toEqual({ errors: null, value: NO_FILTERS });
  });

  it.each(['1', String(MAX_PAGE)])('accepts page %s', (page) => {
    expect(validateListQuery({ page }).errors).toBeNull();
  });

  it.each(['0', '-2', '1.0', '1e2', ' 1', '01', String(MAX_PAGE + 1)])('rejects page %s', (page) => {
    expect(validateListQuery({ page }).errors).toEqual({ page: 'Page must be a whole number from 1 to 100,000.' });
  });

  it('accepts a search of exactly the limit and rejects one character more', () => {
    expect(validateListQuery({ q: 'x'.repeat(MAX_SEARCH_LENGTH) }).errors).toBeNull();
    expect(validateListQuery({ q: 'x'.repeat(MAX_SEARCH_LENGTH + 1) }).errors).toEqual({
      q: `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
    });
  });

  it.each([
    ['page', 'Page', { page: ['1', '2'] }],
    ['q', 'Search', { q: ['a', 'b'] }],
    ['from', 'From date', { from: ['2026-01-01', '2026-02-01'] }],
    ['to', 'To date', { to: ['2026-01-01', '2026-02-01'] }],
  ])('rejects %s given more than once', (field, label, query) => {
    expect(validateListQuery(query).errors).toEqual({ [field]: `${label} must be given only once.` });
  });

  it('rejects a nested object, as ?q[a]=b might parse to', () => {
    expect(validateListQuery({ q: { a: 'b' } }).errors).toEqual({ q: 'Search must be text.' });
    expect(validateListQuery({ category: { a: 'b' } }).errors).toEqual({ category: 'Category must be text.' });
  });

  it('allows from and to on the same day, and rejects to before from', () => {
    expect(validateListQuery({ from: '2026-09-15', to: '2026-09-15' }).errors).toBeNull();
    expect(validateListQuery({ from: '2026-09-16', to: '2026-09-15' }).errors).toEqual({
      to: 'To date must be on or after the From date.',
    });
  });

  it('does not compare the range when one end is already invalid', () => {
    expect(validateListQuery({ from: '2026-13-01', to: '2026-01-01' }).errors).toEqual({
      from: 'From date must be a real calendar date.',
    });
  });
});
