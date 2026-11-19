import { describe, expect, it, vi } from 'vitest';
import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  respondToDatabaseError,
  userGoneError,
  violates,
} from '../src/databaseErrors.js';
import { ConflictError, UnauthorizedError } from '../src/errors.js';

function pgError(code, constraint) {
  return Object.assign(new Error('database error'), { code, constraint });
}

function fakeResponse() {
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return res;
}

describe('violates', () => {
  it('matches both the error code and the constraint', () => {
    const err = pgError(UNIQUE_VIOLATION, 'budgets_user_id_category_key');
    expect(violates(err, UNIQUE_VIOLATION, 'budgets_user_id_category_key')).toBe(true);
    expect(violates(err, FOREIGN_KEY_VIOLATION, 'budgets_user_id_category_key')).toBe(false);
    expect(violates(err, UNIQUE_VIOLATION, 'another_constraint')).toBe(false);
  });

  it('is false for errors that are not from Postgres, and for nothing at all', () => {
    expect(violates(new Error('boom'), UNIQUE_VIOLATION, 'budgets_user_id_category_key')).toBe(false);
    expect(violates(undefined, UNIQUE_VIOLATION, 'budgets_user_id_category_key')).toBe(false);
  });
});

describe('userGoneError', () => {
  it('is a 401 that asks the user to log in again', () => {
    const err = userGoneError();
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('User account no longer exists. Log in again.');
  });
});

describe('respondToDatabaseError', () => {
  const err = pgError(UNIQUE_VIOLATION, 'some_constraint');

  it('rethrows the database error when it maps to nothing, so it becomes a 500', () => {
    expect(() => respondToDatabaseError(err, fakeResponse(), null)).toThrow(err);
  });

  it('throws an HttpError it was given, for the error handler to send', () => {
    const conflict = new ConflictError('You already have one.');
    expect(() => respondToDatabaseError(err, fakeResponse(), conflict)).toThrow(conflict);
  });

  it('sends a 400 with the field errors it was given', () => {
    const res = fakeResponse();
    respondToDatabaseError(err, res, { errors: { category: 'Category must be Food.' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ errors: { category: 'Category must be Food.' } });
  });
});
