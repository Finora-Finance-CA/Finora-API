// Minimal auth added for US-13 so the transaction endpoints know who the user is.
// Ayaan owns auth (US-01 to US-05) and is free to change or replace this file.
//
// Access tokens are JWTs signed with JWT_SECRET using HS256, with:
//   sub  the user's id (users.id, a UUID)
//   type 'access', so other tokens signed with the same secret later (refresh,
//        password reset, ...) can never be used as a login token
//   exp  expiry, always set

import jwt from 'jsonwebtoken';

const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TYPE = 'access';
export const DEFAULT_TOKEN_EXPIRY = '1h';

// HS256 keys shorter than 256 bits (32 bytes) are easier to brute force.
const RECOMMENDED_SECRET_BYTES = 32;

// users.id is a UUID, so any other subject would fail as soon as it reached the database.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read on every call (not at import) so tests and scripts can set it after loading this module.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to .env (see .env.example).');
  }
  return secret;
}

/**
 * Checks the auth configuration at startup. Throws if JWT_SECRET is missing and
 * warns if it is too short. Never logs the secret itself.
 */
export function assertAuthConfig() {
  const secret = getSecret();
  if (Buffer.byteLength(secret, 'utf8') < RECOMMENDED_SECRET_BYTES) {
    console.warn(
      `Warning: JWT_SECRET is shorter than ${RECOMMENDED_SECRET_BYTES} bytes. ` +
        'Use a long random value, e.g. the output of: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
    );
  }
}

/**
 * Creates a signed access token for a user. Call this after a successful login.
 *
 * @param {string} userId The user's id (users.id, a UUID).
 * @param {object} [options]
 * @param {string|number} [options.expiresIn] Lifetime, e.g. '15m', '1h' or seconds. Defaults to 1 hour.
 * @returns {string} The JWT to send to the client.
 */
export function signToken(userId, { expiresIn = DEFAULT_TOKEN_EXPIRY } = {}) {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw new TypeError('signToken expects the user id as a UUID string.');
  }
  return jwt.sign({ type: ACCESS_TOKEN_TYPE }, getSecret(), {
    algorithm: ALGORITHM,
    subject: userId,
    expiresIn,
  });
}

/**
 * Checks an access token's signature, expiry and type, and returns who it belongs to.
 *
 * @param {string} token The raw JWT (without the "Bearer " prefix).
 * @returns {{ userId: string }}
 * @throws {jwt.TokenExpiredError} If the token has expired.
 * @throws {jwt.JsonWebTokenError} If the token is malformed, tampered with, not an
 *   access token, or missing `sub` or `exp`.
 */
export function verifyToken(token) {
  // Pinning the algorithm stops a token from choosing a weaker one (e.g. "none").
  const payload = jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] });

  if (payload.type !== ACCESS_TOKEN_TYPE) {
    throw new jwt.JsonWebTokenError('Token is not an access token.');
  }
  if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
    throw new jwt.JsonWebTokenError('Token subject is not a valid user id.');
  }
  if (typeof payload.exp !== 'number') {
    throw new jwt.JsonWebTokenError('Token has no expiry.');
  }
  return { userId: payload.sub };
}

// Lets callers tell "bad token" (respond 401) apart from a server problem such as a missing secret.
// TokenExpiredError and NotBeforeError both extend JsonWebTokenError.
export function isTokenError(err) {
  return err instanceof jwt.JsonWebTokenError;
}

export function isTokenExpiredError(err) {
  return err instanceof jwt.TokenExpiredError;
}
