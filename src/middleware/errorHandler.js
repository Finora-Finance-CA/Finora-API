// Central error handling. Every failure leaves the API as JSON, and unexpected
// errors are logged server-side but never shown to the client.

import { HttpError } from '../errors.js';

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

  // Other client errors raised by express.json() (body too large, bad charset, ...)
  // carry a safe message and a 4xx status.
  const status = err.status ?? err.statusCode;
  if (err.expose && status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message });
  }

  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: 'Something went wrong. Please try again later.' });
}
