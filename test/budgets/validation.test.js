import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import { validateBudgetId, validateBudgetUpdate, validateNewBudget } from '../../src/budgets/validation.js';

const CATEGORY_ERROR = 'Category must be one of Food, Transportation, Housing, Entertainment or Other.';

describe('validateNewBudget', () => {
  it('accepts a category and a limit, ignoring other fields', () => {
    expect(validateNewBudget({ category: 'Food', limit_cents: 50000, user_id: 'x', id: '9' })).toEqual({
      errors: null,
      value: { category: 'Food', limit_cents: 50000 },
    });
  });

  it.each(['Food', 'Transportation', 'Housing', 'Entertainment', 'Other'])('accepts the category %s', (category) => {
    expect(validateNewBudget({ category, limit_cents: 1 }).errors).toBeNull();
  });

  it('reports every missing field at once', () => {
    expect(validateNewBudget({}).errors).toEqual({
      category: 'Category is required.',
      limit_cents: 'Limit is required.',
    });
  });

  it.each(['Groceries', 'food', 'FOOD', 42])('rejects the category %j', (category) => {
    expect(validateNewBudget({ category, limit_cents: 100 }).errors).toEqual({ category: CATEGORY_ERROR });
  });

  it.each([
    ['zero', 0, 'Limit must be greater than 0.'],
    ['negative', -500, 'Limit must be greater than 0.'],
    ['a decimal', 12.5, 'Limit must be a whole number of cents, for example 1250 for $12.50.'],
    ['a numeric string', '500', 'Limit must be a whole number of cents, for example 1250 for $12.50.'],
    ['a boolean', true, 'Limit must be a whole number of cents, for example 1250 for $12.50.'],
    ['too large', MAX_AMOUNT_CENTS + 1, 'Limit must be $21,474,836.47 or less.'],
    ['null', null, 'Limit is required.'],
  ])('rejects a limit that is %s', (_, limit_cents, message) => {
    expect(validateNewBudget({ category: 'Food', limit_cents }).errors).toEqual({ limit_cents: message });
  });

  it.each([1, MAX_AMOUNT_CENTS])('accepts the limit %i', (limit_cents) => {
    expect(validateNewBudget({ category: 'Food', limit_cents }).errors).toBeNull();
  });

  it.each([null, [], 'Food', undefined])('rejects the body %j', (body) => {
    expect(validateNewBudget(body).errors).toEqual({
      body: 'Request body must be a JSON object.',
    });
  });
});

describe('validateBudgetUpdate', () => {
  it('takes only the limit; the category cannot change', () => {
    expect(validateBudgetUpdate({ limit_cents: 7500, category: 'Housing' })).toEqual({
      errors: null,
      value: { limit_cents: 7500 },
    });
  });

  it.each([
    [0, 'Limit must be greater than 0.'],
    [-1, 'Limit must be greater than 0.'],
    [undefined, 'Limit is required.'],
  ])('rejects the limit %j', (limit_cents, message) => {
    expect(validateBudgetUpdate({ limit_cents }).errors).toEqual({ limit_cents: message });
  });
});

describe('validateBudgetId', () => {
  it.each(['1', '9223372036854775807'])('accepts %s', (id) => {
    expect(validateBudgetId(id)).toBeNull();
  });

  it.each(['0', '-1', '1.5', 'abc', '01', '9223372036854775808'])('rejects %s', (id) => {
    expect(validateBudgetId(id)).toBe('ID must be a positive whole number.');
  });
});
