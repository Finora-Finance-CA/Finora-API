// Builds the Express app without starting a server, so tests can import it
// (e.g. with supertest) and server.js only has to listen.

import express from 'express';
import { corsMiddleware, parseAllowedOrigins } from './cors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { budgetsRouter } from './routes/budgets.js';
import { healthRouter } from './routes/health.js';
import { summaryRouter } from './routes/summary.js';
import { transactionsRouter } from './routes/transactions.js';

/**
 * @param {{ allowedOrigins?: string[] }} [options] Sites allowed to call the API from a
 *   browser. Defaults to CLIENT_ORIGIN (see src/cors.js).
 */
export function createApp({ allowedOrigins = parseAllowedOrigins(process.env.CLIENT_ORIGIN) } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // First, so a preflight (OPTIONS) request is answered before anything else runs.
  app.use(corsMiddleware(allowedOrigins));
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/summary', summaryRouter);
  app.use('/api/budgets', budgetsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
