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
      name: 'Name is required.',
      target_cents: 'Target is required.',
    });
  });

  it.each([
    ['only spaces', '   ', 'Name is required.'],
    ['empty', '', 'Name is required.'],
    ['a number', 42, 'Name must be text.'],
    ['too long', 'x'.repeat(MAX_GOAL_NAME_LENGTH + 1), `Name must be ${MAX_GOAL_NAME_LENGTH} characters or fewer.`],
  ])('rejects a name that is %s', (_, name, message) => {
    expect(validateGoalBody({ ...VALID, name }).errors).toEqual({ name: message });
  });

  it('accepts a name of exactly 60 characters, counting an emoji as one, as Postgres does', () => {
    expect(validateGoalBody({ ...VALID, name: 'x'.repeat(60) }).errors).toBeNull();
    // 60 code points, but 120 UTF-16 units, which is what String.length counts.
    expect(validateGoalBody({ ...VALID, name: '🎯'.repeat(60) }).errors).toBeNull();
    expect(validateGoalBody({ ...VALID, name: '🎯'.repeat(61) }).errors).toEqual({
      name: 'Name must be 60 characters or fewer.',
    });
  });

  it.each([
    ['zero', 0, 'Target must be greater than 0.'],
    ['negative', -500, 'Target must be greater than 0.'],
    ['a decimal', 12.5, 'Target must be a whole number of cents, for example 1250 for $12.50.'],
    ['a numeric string', '500', 'Target must be a whole number of cents, for example 1250 for $12.50.'],
    ['too large', MAX_AMOUNT_CENTS + 1, 'Target must be $21,474,836.47 or less.'],
  ])('rejects a target that is %s', (_, target_cents, message) => {
    expect(validateGoalBody({ ...VALID, target_cents }).errors).toEqual({ target_cents: message });
  });

  it.each([
    ['2027-02-30', 'Target date must be a real calendar date.'],
    ['2027-6-30', 'Target date must be in YYYY-MM-DD format, for example 2026-10-05.'],
    ['June 30', 'Target date must be in YYYY-MM-DD format, for example 2026-10-05.'],
    [20270630, 'Target date must be in YYYY-MM-DD format, for example 2026-10-05.'],
    ['1899-12-31', 'Target date must be between 1900-01-01 and 2100-12-31.'],
  ])('rejects the target_date %j', (target_date, message) => {
    expect(validateGoalBody({ ...VALID, target_date }).errors).toEqual({ target_date: message });
  });

  it.each([null, [], 'text'])('rejects a body that is %j', (body) => {
    expect(validateGoalBody(body).errors).toEqual({
      body: 'Request body must be a JSON object.',
    });
  });
});

describe('validateGoalId', () => {
  it.each(['1', '9223372036854775807'])('accepts %s', (id) => {
    expect(validateGoalId(id)).toBeNull();
  });

  it.each(['abc', '0', '-1', '1.5', '01', '9223372036854775808'])('rejects %s', (id) => {
    expect(validateGoalId(id)).toBe('ID must be a positive whole number.');
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
