import { describe, expect, it } from 'vitest';
import { monthRange, validateSummaryQuery } from '../../src/summary/validation.js';

describe('monthRange', () => {
  it.each([
    [2026, 10, '2026-10-01', '2026-11-01'],
    [2026, 1, '2026-01-01', '2026-02-01'],
    [2026, 9, '2026-09-01', '2026-10-01'],
    [2026, 12, '2026-12-01', '2027-01-01'],
    [1999, 12, '1999-12-01', '2000-01-01'],
    [2028, 2, '2028-02-01', '2028-03-01'],
  ])('%i-%i runs from %s up to (not including) %s', (year, month, start, end) => {
    expect(monthRange(year, month)).toEqual({ start, end });
  });
});

describe('validateSummaryQuery', () => {
  it('accepts a month and gives its date range', () => {
    expect(validateSummaryQuery({ month: '2026-10' })).toEqual({
      errors: null,
      value: { month: '2026-10', start: '2026-10-01', end: '2026-11-01' },
    });
  });

  it.each([
    ['missing', {}],
    ['empty', { month: '' }],
  ])('requires the month when it is %s', (_, query) => {
    expect(validateSummaryQuery(query).errors).toEqual({ month: 'month is required, in YYYY-MM format, e.g. 2026-10.' });
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026/10', '26-10', '2026-10-01', 'October', ' 2026-10'])(
    'rejects %j',
    (month) => {
      expect(validateSummaryQuery({ month }).errors).toEqual({
        month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.',
      });
    }
  );

  it('rejects a month before 1900', () => {
    expect(validateSummaryQuery({ month: '1899-12' }).errors).toEqual({ month: 'month must be in 1900 or later.' });
  });

  it('rejects a month given twice, or as an object', () => {
    expect(validateSummaryQuery({ month: ['2026-10', '2026-11'] }).errors).toEqual({
      month: 'month must be given only once.',
    });
    expect(validateSummaryQuery({ month: { a: 'b' } }).errors).toEqual({
      month: 'month must be a real month in YYYY-MM format, e.g. 2026-10.',
    });
  });

  it('accepts the first month allowed', () => {
    expect(validateSummaryQuery({ month: '1900-01' }).errors).toBeNull();
  });
});
