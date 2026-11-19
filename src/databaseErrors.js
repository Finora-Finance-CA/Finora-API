// Turns a Postgres error the client caused into the right response, for the routes that
// write rows. Validation catches nearly all of these first; this covers what only the
// database can know (a duplicate budget category, a deleted user) and anything that
// ever slips past validation, so none of them become a 500.

import { HttpError, UnauthorizedError } from './errors.js';

// Postgres error codes.
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const CHECK_VIOLATION = '23514';

/** True if `err` is a Postgres error with this code, raised by this constraint. */
export function violates(err, code, constraint) {
  return err?.code === code && err.constraint === constraint;
}

/** For a write whose user_id no longer exists: the token was valid, but the user has since been deleted. */
export function userGoneError() {
  return new UnauthorizedError('User account no longer exists. Log in again.');
}

/**
 * Sends the 400, or throws the HttpError, that a route mapped a database error to, and
 * rethrows the original error if it mapped it to nothing (a real server problem).
 *
 * @param {Error} err The database error.
 * @param {import('express').Response} res
 * @param {HttpError | { errors: Record<string, string> } | null} clientError
 */
export function respondToDatabaseError(err, res, clientError) {
  if (!clientError) throw err;
  if (clientError instanceof HttpError) throw clientError;
  return res.status(400).json(clientError);
}
