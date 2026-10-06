// Errors that map to an HTTP response. Throw (or pass to next()) one of these from
// any route or middleware and the central error handler sends { error: message }
// with the given status, instead of a generic 500.

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code (4xx).
   * @param {string} message Safe to show to the client.
   * @param {{ headers?: Record<string, string> }} [options] Extra response headers.
   */
  constructor(status, message, { headers = {} } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

// 401: not logged in, or the token is no longer good. Sets WWW-Authenticate as HTTP requires.
export class UnauthorizedError extends HttpError {
  constructor(message = 'Authentication required.') {
    super(401, message, { headers: { 'WWW-Authenticate': 'Bearer' } });
    this.name = 'UnauthorizedError';
  }
}
