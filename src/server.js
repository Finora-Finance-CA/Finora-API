import 'dotenv/config';
import { createApp } from './app.js';
import { assertAuthConfig } from './auth/tokens.js';
import { pool } from './db.js';

// Fail at startup rather than on the first authenticated request.
try {
  assertAuthConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = createApp();
const port = process.env.PORT || 4000;

// Express 5 passes listen errors (e.g. port already in use) to this callback.
const server = app.listen(port, (err) => {
  if (err) {
    console.error(`Could not start the API on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`API running on http://localhost:${port}`);
});

// Finish in-flight requests and close database connections before exiting.
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
