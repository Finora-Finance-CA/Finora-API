// The check that keeps the integration tests (npm run test:integration) away from any
// real database. They wipe and rebuild the database they run on, so it must be a
// throwaway one on this machine, named as a test database.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Checks TEST_DATABASE_URL and returns it.
 *
 * @param {string|undefined} value The raw TEST_DATABASE_URL.
 * @returns {string} The same URL, safe to use as DATABASE_URL.
 * @throws {Error} Unless it's a postgres URL on localhost or 127.0.0.1 whose database
 *   name contains "test".
 */
export function localTestDatabaseUrl(value) {
  const fail = (reason) => {
    throw new Error(
      `Refusing to run the integration tests: ${reason} They wipe the database they use, so ` +
        'TEST_DATABASE_URL must be a throwaway local Postgres, e.g. ' +
        'postgresql://postgres:postgres@localhost:5433/finora_test. See "Integration tests" in the README.'
    );
  };

  if (!value) fail('TEST_DATABASE_URL is not set.');

  let url;
  try {
    url = new URL(value);
  } catch {
    fail('TEST_DATABASE_URL is not a valid URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('TEST_DATABASE_URL must start with postgresql://.');
  if (!LOCAL_HOSTS.has(url.hostname)) fail(`its host is "${url.hostname}", not localhost or 127.0.0.1.`);

  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/test/i.test(database)) fail(`its database "${database}" doesn't have "test" in its name.`);

  return value;
}
