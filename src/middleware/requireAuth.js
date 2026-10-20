import { InvalidTokenError, verifySupabaseToken } from '../auth/supabaseTokens.js';
import { UnauthorizedError } from '../errors.js';

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

export async function requireAuth(req, res, next) {
  const header = req.get('Authorization');
  if (!header) {
    return next(new UnauthorizedError('Authentication required. Send an Authorization: Bearer <token> header.'));
  }

  const match = BEARER_PATTERN.exec(header);
  if (!match) {
    return next(new UnauthorizedError('Authorization header must be in the format: Bearer <token>.'));
  }

  try {
    const { userId } = await verifySupabaseToken(match[1]);
    req.user = { id: userId };
    return next();
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      return next(new UnauthorizedError(err.message));
    }
    // Anything else (e.g. Supabase unreachable, missing config) is a server problem.
    return next(err);
  }
}