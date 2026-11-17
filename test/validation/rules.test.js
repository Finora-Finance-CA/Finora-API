// US-53, US-54: the shared checks every request is validated with
// (src/validation/rules.js), and the exact message each gives. The per-endpoint tests
// in invalidInput.test.js send the same cases through the real routes.

import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import {
  MAX_DATE,
  MESSAGES,
  MIN_DATE,
  characterCount,
  choiceList,
  collectErrors,
  dollarText,
  isJsonObject,
  validateCents,
  validateChoice,
  validateDate,
  validateId,
  validateText,
} from '../../src/validation/rules.js';

describe('validateCents', () => {
  const label = 'Amount';

  it.each([
    ['1 cent, the smallest amount', 1],
    ['a typical amount', 1250],
    ['the largest amount, $21,474,836.47', MAX_AMOUNT_CENTS],
  ])('accepts %s', (_, value) => {
    expect(validateCents(value, label)).toBeNull();
  });

  it.each([
    ['missing', undefined, 'Amount is required.'],
    ['null', null, 'Amount is required.'],
    ['an empty string', '', 'Amount is required.'],
    ['zero', 0, 'Amount must be greater than 0.'],
    ['negative zero', -0, 'Amount must be greater than 0.'],
    ['negative', -1, 'Amount must be greater than 0.'],
    ['one cent over the maximum', MAX_AMOUNT_CENTS + 1, 'Amount must be $21,474,836.47 or less.'],
    ['huge', 1e21, 'Amount must be $21,474,836.47 or less.'],
    ['a fraction of a cent', 0.5, MESSAGES.wholeCents('Amount')],
    ['too many decimals', 1250.001, MESSAGES.wholeCents('Amount')],
    ['a numeric string', '1250', MESSAGES.wholeCents('Amount')],
    ['a string with letters after digits', '12abc', MESSAGES.wholeCents('Amount')],
    ['an exponent string', '1e3', MESSAGES.wholeCents('Amount')],
    ['the string "Infinity"', 'Infinity', MESSAGES.wholeCents('Amount')],
    ['the string "NaN"', 'NaN', MESSAGES.wholeCents('Amount')],
    ['a padded number string', ' 1250 ', MESSAGES.wholeCents('Amount')],
    ['NaN', Number.NaN, MESSAGES.wholeCents('Amount')],
    ['Infinity, as a too-big JSON number arrives', Number.POSITIVE_INFINITY, MESSAGES.wholeCents('Amount')],
    ['minus Infinity', Number.NEGATIVE_INFINITY, MESSAGES.wholeCents('Amount')],
    ['a boolean', true, MESSAGES.wholeCents('Amount')],
    ['an array', [1250], MESSAGES.wholeCents('Amount')],
    ['an object', { cents: 1250 }, MESSAGES.wholeCents('Amount')],
  ])('rejects %s', (_, value, message) => {
    expect(validateCents(value, label)).toBe(message);
  });

  it('names the field with the label it is given, never a column name', () => {
    expect(validateCents(0, 'Target')).toBe('Target must be greater than 0.');
    expect(validateCents('x', 'Limit')).toBe('Limit must be a whole number of cents, for example 1250 for $12.50.');
  });
});

describe('validateDate', () => {
  const label = 'Date';

  it.each([
    ['the first allowed day', MIN_DATE],
    ['the last allowed day', MAX_DATE],
    ['a leap day', '2024-02-29'],
    ['a leap day in a century divisible by 400', '2000-02-29'],
    ['the last day of a 30-day month', '2026-04-30'],
    ['New Year’s Eve', '2026-12-31'],
  ])('accepts %s', (_, value) => {
    expect(validateDate(value, label)).toBeNull();
  });

  it.each([
    ['missing', undefined, 'Date is required.'],
    ['null', null, 'Date is required.'],
    ['an empty string', '', 'Date is required.'],
    ['single-digit month and day', '2026-1-5', MESSAGES.dateFormat('Date')],
    ['slashes', '2026/10/05', MESSAGES.dateFormat('Date')],
    ['day first', '05-10-2026', MESSAGES.dateFormat('Date')],
    ['no separators', '20261005', MESSAGES.dateFormat('Date')],
    ['a time', '2026-10-05T00:00:00Z', MESSAGES.dateFormat('Date')],
    ['a leading space', ' 2026-10-05', MESSAGES.dateFormat('Date')],
    ['a trailing space', '2026-10-05 ', MESSAGES.dateFormat('Date')],
    ['a trailing newline', '2026-10-05\n', MESSAGES.dateFormat('Date')],
    ['a five-digit year', '20260-10-05', MESSAGES.dateFormat('Date')],
    ['words', 'yesterday', MESSAGES.dateFormat('Date')],
    ['a number', 20261005, MESSAGES.dateFormat('Date')],
    ['a timestamp number', 1791158400000, MESSAGES.dateFormat('Date')],
    ['an array', ['2026-10-05'], MESSAGES.dateFormat('Date')],
    ['Feb 29 in a non-leap year', '2025-02-29', 'Date must be a real calendar date.'],
    ['Feb 29 in 1900, not a leap year', '1900-02-29', 'Date must be a real calendar date.'],
    ['Feb 29 in 2100, not a leap year', '2100-02-29', 'Date must be a real calendar date.'],
    ['Feb 30', '2026-02-30', 'Date must be a real calendar date.'],
    ['April 31', '2026-04-31', 'Date must be a real calendar date.'],
    ['month 13', '2026-13-01', 'Date must be a real calendar date.'],
    ['month 0', '2026-00-10', 'Date must be a real calendar date.'],
    ['day 0', '2026-10-00', 'Date must be a real calendar date.'],
    ['day 32', '2026-01-32', 'Date must be a real calendar date.'],
    ['the day before the range', '1899-12-31', 'Date must be between 1900-01-01 and 2100-12-31.'],
    ['the day after the range', '2101-01-01', 'Date must be between 1900-01-01 and 2100-12-31.'],
    ['year 0050, which Date.UTC would read as 1950', '0050-06-15', 'Date must be between 1900-01-01 and 2100-12-31.'],
  ])('rejects %s', (_, value, message) => {
    expect(validateDate(value, label)).toBe(message);
  });

  it('allows a missing date when it is optional, but still checks one that is given', () => {
    for (const value of [undefined, null, '']) expect(validateDate(value, 'Target date', { required: false })).toBeNull();
    expect(validateDate('2025-02-29', 'Target date', { required: false })).toBe('Target date must be a real calendar date.');
  });
});

describe('validateChoice', () => {
  it('accepts an exact match and lists the choices in plain words otherwise', () => {
    expect(validateChoice('expense', 'Type', ['income', 'expense'])).toBeNull();
    expect(validateChoice('Expense', 'Type', ['income', 'expense'])).toBe('Type must be income or expense.');
    expect(validateChoice(' Food', 'Category', ['Food', 'Other'])).toBe('Category must be Food or Other.');
    expect(validateChoice(3, 'Category', ['Food', 'Housing', 'Other'])).toBe(
      'Category must be one of Food, Housing or Other.'
    );
  });

  it('treats missing as required unless told otherwise', () => {
    expect(validateChoice(null, 'Type', ['income', 'expense'])).toBe('Type is required.');
    expect(validateChoice('', 'Category', ['Food'], { required: false })).toBeNull();
  });
});

describe('validateText', () => {
  it('trims before checking, and counts characters as Postgres does', () => {
    expect(validateText(`  ${'a'.repeat(5)}  `, 'Name', { max: 5 })).toBeNull();
    expect(validateText('😀'.repeat(5), 'Name', { max: 5 })).toBeNull();
    expect(validateText('😀'.repeat(6), 'Name', { max: 5 })).toBe('Name must be 5 characters or fewer.');
  });

  it('rejects text that is not a string', () => {
    for (const value of [42, true, ['a'], { a: 1 }]) expect(validateText(value, 'Description', { max: 5 })).toBe('Description must be text.');
  });

  it('treats blank as missing when the text is required', () => {
    for (const value of [undefined, null, '', '   ']) expect(validateText(value, 'Name', { required: true, max: 5 })).toBe('Name is required.');
    expect(validateText(null, 'Description', { max: 5 })).toBeNull();
  });
});

describe('validateId', () => {
  it.each(['1', '42', '9223372036854775807'])('accepts %s', (id) => {
    expect(validateId(id)).toBeNull();
  });

  it.each(['', '0', '-1', '01', '1.5', '1e3', 'abc', ' 1', '1 ', '0x10', '9223372036854775808'])('rejects "%s"', (id) => {
    expect(validateId(id)).toBe('ID must be a positive whole number.');
  });
});

describe('helpers', () => {
  it('writes dollars from cents with whole-number maths', () => {
    expect(dollarText(MAX_AMOUNT_CENTS)).toBe('$21,474,836.47');
    expect(dollarText(5)).toBe('$0.05');
    expect(dollarText(100000)).toBe('$1,000.00');
  });

  it('lists choices with "or" before the last one', () => {
    expect(choiceList(['a'])).toBe('a');
    expect(choiceList(['a', 'b'])).toBe('a or b');
    expect(choiceList(['a', 'b', 'c'])).toBe('a, b or c');
  });

  it('counts emoji as one character each', () => {
    expect(characterCount('a😀')).toBe(2);
  });

  it('keeps only the failed checks', () => {
    expect(collectErrors({ a: null, b: 'B is required.' })).toEqual({ b: 'B is required.' });
    expect(collectErrors({ a: null })).toBeNull();
  });

  it('only counts a plain object as a JSON object body', () => {
    expect(isJsonObject({})).toBe(true);
    for (const body of [null, undefined, [], 'text', 42]) expect(isJsonObject(body)).toBe(false);
  });

  it('never names a JSON key or column in any message', () => {
    const messages = Object.entries(MESSAGES).map(([key, message]) => {
      if (typeof message !== 'function') return message;
      return key === 'choice' ? message('Type', ['income', 'expense']) : message('Amount', 5);
    });
    for (const message of messages) expect(message).not.toMatch(/_cents|_date|user_id|\bq\b/);
  });
});
