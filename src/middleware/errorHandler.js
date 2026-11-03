// Central error handling. Every failure leaves the API as JSON, and unexpected
// errors are logged server-side but never shown to the client.

import { HttpError } from '../errors.js';
import { validateTransactionId } from '../transactions/validation.js';

// The message every id validator gives for a bad :id (validateTransactionId, and the
// budget and goal validators built on it).
const INVALID_ID = validateTransactionId('');

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// Express recognises error handlers by their four arguments, so `next` must stay.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Errors thrown on purpose by our own code (401, 404, 409, ...).
  if (err instanceof HttpError) {
    return res.set(err.headers).status(err.status).json({ error: err.message });
  }

  // Malformed JSON body, reported in the same shape as validation errors.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errors: { body: 'Request body must be valid JSON.' } });
  }

  // A route parameter Express couldn't decode, e.g. PUT /api/budgets/%ZZ. The router
  // throws a URIError with status 400 before any handler runs. :id is the only route
  // parameter the API has, so it's reported the way the id validators report a bad id.
  // The raw value isn't echoed back.
  if (err instanceof URIError && err.status === 400) {
    return res.status(400).json({ errors: { id: INVALID_ID } });
  }

  // Other client errors raised by express.json() (body too large, bad charset, ...)
  // carry a safe message and a 4xx status.
  const status = err.status ?? err.statusCode;
  if (err.expose && status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: 'Something went wrong. Please try again later.' });
}
