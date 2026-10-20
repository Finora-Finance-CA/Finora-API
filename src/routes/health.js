// GET /health. Public (no token needed), so it can be used by uptime checks and
// by developers to confirm the API and database are both up.

import { Router } from 'express';
import { pingDatabase } from '../db.js';

// Connection failures can be an AggregateError (one error per IPv4/IPv6 address)
// with an empty message, so fall back to the error code.
function describeError(err) {
  return err?.message || err?.code || String(err);
}

export async function handleHealthCheck(req, res) {
  // Always report the live state, never a cached one.
  res.set('Cache-Control', 'no-store');

  try {
    await pingDatabase();
  } catch (err) {
    // The reason is logged for us, but never sent to the client.
    console.error('Health check: database unreachable:', describeError(err));
    return res.status(503).json({ status: 'error', database: 'unreachable' });
  }

  return res.json({ status: 'ok', database: 'ok' });
}

export const healthRouter = Router();

healthRouter.get('/', handleHealthCheck);
