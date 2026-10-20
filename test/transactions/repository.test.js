import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '../../src/transactions/repository.js';

describe('escapeLikePattern', () => {
  it.each([
    ['plain text', 'Lunch', 'Lunch'],
    ['a percent sign', '50%', '50\\%'],
    ['an underscore', 'file_name', 'file\\_name'],
    ['a backslash', 'C:\\temp', 'C:\\\\temp'],
    ['all of them', '%_\\', '\\%\\_\\\\'],
  ])('escapes %s', (_, input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });
});
