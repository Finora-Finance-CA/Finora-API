// Builds the Express app without starting a server, so tests can import it
// (e.g. with supertest) and server.js only has to listen.

import express from 'express';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { transactionsRouter } from './routes/transactions.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/transactions', transactionsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
