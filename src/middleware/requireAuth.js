// Minimal auth added for US-13 so the transaction endpoints know who the user is.
// Ayaan owns auth (US-01 to US-05) and is free to change or replace this file.
//
// Expects `Authorization: Bearer <token>`. On success sets req.user = { id } and
// continues; otherwise passes an UnauthorizedError on, which the error handler
// turns into 401 { error }.
//
// It trusts the token without a database lookup, so a deleted user's token stays
// valid until it expires. Routes that write rows owned by the user handle that case.

import { isTokenError, isTokenExpiredError, verifyToken } from '../auth/tokens.js';
import { UnauthorizedError } from '../errors.js';

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

export function requireAuth(req, res, next) {
  const header = req.get('Authorization');
  if (!header) {
    return next(new UnauthorizedError('Authentication required. Send an Authorization: Bearer <token> header.'));
  }

  const match = BEARER_PATTERN.exec(header);
  if (!match) {
    return next(new UnauthorizedError('Authorization header must be in the format: Bearer <token>.'));
  }

  try {
    const { userId } = verifyToken(match[1]);
    req.user = { id: userId };
    return next();
  } catch (err) {
    if (isTokenExpiredError(err)) {
      return next(new UnauthorizedError('Token has expired. Log in again.'));
    }
    if (isTokenError(err)) {
      return next(new UnauthorizedError('Invalid token.'));
    }
    // Anything else (e.g. JWT_SECRET missing) is a server problem, not the client's.
    return next(err);
  }
}
