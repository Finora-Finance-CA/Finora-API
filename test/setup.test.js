// Guards the test setup itself: if the fakes ever stopped being installed, these fail
// before any test could reach the shared database or Supabase.

import { describe, expect, it } from 'vitest';
import * as db from '../src/db.js';
import * as tokens from '../src/auth/supabaseTokens.js';
import { fakeDbModule } from './support/fakeDatabase.js';
import { verifySupabaseToken } from './support/fakeAuth.js';

describe('test isolation', () => {
  it('replaces src/db.js with the in-memory fake', () => {
    expect(db.pool).toBe(fakeDbModule.pool);
    expect(db.query).toBe(fakeDbModule.query);
    expect(db.pingDatabase).toBe(fakeDbModule.pingDatabase);
  });

  it('replaces Supabase token verification with the fake', () => {
    expect(tokens.verifySupabaseToken).toBe(verifySupabaseToken);
  });

  it('blanks the real connection settings', () => {
    expect(process.env.DATABASE_URL).toBe('');
    expect(process.env.SUPABASE_URL).toBe('');
    expect(process.env.SUPABASE_PUBLISHABLE_KEY).toBe('');
  });
});
