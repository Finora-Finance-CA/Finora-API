// The integration tests' safety check: they only ever run on a throwaway local database.

import { describe, expect, it } from 'vitest';
import { localTestDatabaseUrl } from './testDatabaseGuard.js';

describe('localTestDatabaseUrl', () => {
  it.each([
    'postgresql://postgres:postgres@localhost:5432/finora_test',
    'postgres://postgres:secret@127.0.0.1:5433/test',
    'postgresql://u:p@localhost/integration_TEST_db',
  ])('accepts %s', (url) => {
    expect(localTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    ['missing', undefined, /not set/],
    ['empty', '', /not set/],
    ['not a URL', 'localhost:5432/finora_test', /not a valid URL|postgresql/],
    ['another protocol', 'mysql://u:p@localhost/finora_test', /postgresql:\/\//],
    ['a Supabase host', 'postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/finora_test', /not localhost/],
    ['the Supabase pooler', 'postgresql://postgres.abc:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres', /not localhost/],
    ['a host that only starts with localhost', 'postgresql://u:p@localhost.evil.example:5432/finora_test', /not localhost/],
    ['a local database without "test" in its name', 'postgresql://postgres:postgres@localhost:54322/postgres', /"test"/],
  ])('refuses a URL that is %s', (_, url, message) => {
    expect(() => localTestDatabaseUrl(url)).toThrow(message);
  });
});
