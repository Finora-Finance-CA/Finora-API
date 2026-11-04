import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import { MAX_GOAL_NAME_LENGTH, validateGoalBody, validateGoalId } from '../../src/goals/validation.js';
import { toGoal } from '../../src/goals/repository.js';

const VALID = { name: 'Emergency fund', target_cents: 500000, target_date: '2027-06-30' };

describe('validateGoalBody', () => {
  it('accepts a name, target and date, and ignores every other field', () => {
    expect(validateGoalBody({ ...VALID, user_id: 'x', id: '9', saved_cents: 999999 })).toEqual({
      errors: null,
      value: { name: 'Emergency fund', target_cents: 500000, target_date: '2027-06-30' },
    });
  });

  it('trims the name', () => {
    expect(validateGoalBody({ ...VALID, name: '  New laptop  ' }).value.name).toBe('New laptop');
  });

  it.each([undefined, null, ''])('treats a target_date of %j as no date', (target_date) => {
    expect(validateGoalBody({ ...VALID, target_date }).value.target_date).toBeNull();
  });

  it('reports every missing field at once', () => {
    expect(validateGoalBody({}).errors).toEqual({
      name: 'name is required.',
      target_cents: 'target_cents is required.',
    });
  });

  it.each([
    ['only spaces', '   ', 'name is required.'],
    ['empty', '', 'name is required.'],
    ['a number', 42, 'name must be a string.'],
    ['too long', 'x'.repeat(MAX_GOAL_NAME_LENGTH + 1), `name must be at most ${MAX_GOAL_NAME_LENGTH} characters.`],
  ])('rejects a name that is %s', (_, name, message) => {
    expect(validateGoalBody({ ...VALID, name }).errors).toEqual({ name: message });
  });

  it('accepts a name of exactly 60 characters, counting an emoji as one, as Postgres does', () => {
    expect(validateGoalBody({ ...VALID, name: 'x'.repeat(60) }).errors).toBeNull();
    // 60 code points, but 120 UTF-16 units, which is what String.length counts.
    expect(validateGoalBody({ ...VALID, name: '🎯'.repeat(60) }).errors).toBeNull();
    expect(validateGoalBody({ ...VALID, name: '🎯'.repeat(61) }).errors).toEqual({
      name: 'name must be at most 60 characters.',
    });
  });

  it.each([
    ['zero', 0, 'target_cents must be greater than zero.'],
    ['negative', -500, 'target_cents must be greater than zero.'],
    ['a decimal', 12.5, 'target_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    ['a numeric string', '500', 'target_cents must be a whole number of cents, e.g. 1250 for $12.50.'],
    ['too large', MAX_AMOUNT_CENTS + 1, `target_cents must be at most ${MAX_AMOUNT_CENTS}.`],
  ])('rejects a target that is %s', (_, target_cents, message) => {
    expect(validateGoalBody({ ...VALID, target_cents }).errors).toEqual({ target_cents: message });
  });

  it.each([
    ['2027-02-30', 'target_date must be a real calendar date.'],
    ['2027-6-30', 'target_date must be a string in YYYY-MM-DD format.'],
    ['June 30', 'target_date must be a string in YYYY-MM-DD format.'],
    [20270630, 'target_date must be a string in YYYY-MM-DD format.'],
    ['1899-12-31', 'target_date must be in 1900 or later.'],
  ])('rejects the target_date %j', (target_date, message) => {
    expect(validateGoalBody({ ...VALID, target_date }).errors).toEqual({ target_date: message });
  });

  it.each([null, [], 'text'])('rejects a body that is %j', (body) => {
    expect(validateGoalBody(body).errors).toEqual({
      body: 'Request body must be a JSON object. Set Content-Type: application/json.',
    });
  });
});

describe('validateGoalId', () => {
  it.each(['1', '9223372036854775807'])('accepts %s', (id) => {
    expect(validateGoalId(id)).toBeNull();
  });

  it.each(['abc', '0', '-1', '1.5', '01', '9223372036854775808'])('rejects %s', (id) => {
    expect(validateGoalId(id)).toBe('id must be a positive whole number.');
  });
});

describe('toGoal', () => {
  it('turns the BIGINT strings pg returns for target_cents and saved_cents into numbers', () => {
    expect(toGoal({ id: '3', name: 'Trip', target_cents: '250000', saved_cents: '0' })).toEqual({
      id: '3',
      name: 'Trip',
      target_cents: 250000,
      saved_cents: 0,
    });
  });
});
