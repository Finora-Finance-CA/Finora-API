import { describe, expect, it } from 'vitest';
import { readSeedConfig } from '../../scripts/seed/config.js';
import { SeedError } from '../../scripts/seed/errors.js';

const VALID_ENV = Object.freeze({
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/finora',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  SEED_USER_1_EMAIL: 'Sample.One@Example.com ',
  SEED_USER_1_PASSWORD: 'first-password',
  SEED_USER_2_EMAIL: 'sample.two@example.com',
  SEED_USER_2_PASSWORD: 'second-password',
});

function failureFor(env) {
  try {
    readSeedConfig(env);
  } catch (err) {
    return err;
  }
  throw new Error('readSeedConfig did not throw');
}

describe('readSeedConfig', () => {
  it('returns both sample users, with emails trimmed and lower-cased', () => {
    expect(readSeedConfig(VALID_ENV)).toEqual({
      users: [
        { email: 'sample.one@example.com', password: 'first-password' },
        { email: 'sample.two@example.com', password: 'second-password' },
      ],
    });
  });

  it.each(['production', 'Production', ' production '])('refuses to run when NODE_ENV is %j', (NODE_ENV) => {
    const error = failureFor({ ...VALID_ENV, NODE_ENV });

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toMatch(/NODE_ENV is "production"/);
  });

  it('runs when NODE_ENV is development', () => {
    expect(() => readSeedConfig({ ...VALID_ENV, NODE_ENV: 'development' })).not.toThrow();
  });

  it('names every missing or blank variable in one message', () => {
    const error = failureFor({ ...VALID_ENV, SEED_USER_1_PASSWORD: '', SEED_USER_2_EMAIL: '   ', DATABASE_URL: undefined });

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toBe(
      'Missing DATABASE_URL, SEED_USER_1_PASSWORD, SEED_USER_2_EMAIL. Add them to .env (see .env.example).'
    );
  });

  it('rejects the same email for both users, ignoring case and spaces', () => {
    const error = failureFor({ ...VALID_ENV, SEED_USER_2_EMAIL: ' SAMPLE.one@example.com' });

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toBe('Each sample user needs a different email address.');
  });

  it('rejects passwords shorter than 8 characters without printing them', () => {
    const error = failureFor({ ...VALID_ENV, SEED_USER_2_PASSWORD: 'short' });

    expect(error).toBeInstanceOf(SeedError);
    expect(error.message).toBe('SEED_USER_2_PASSWORD must be at least 8 characters.');
  });

  it('never includes a password, key or connection string in its messages', () => {
    const secrets = [VALID_ENV.DATABASE_URL, VALID_ENV.SUPABASE_PUBLISHABLE_KEY, 'first-password', 'second-password', 'tiny'];
    const messages = [
      { ...VALID_ENV, SEED_USER_1_PASSWORD: 'tiny' },
      { ...VALID_ENV, SEED_USER_2_EMAIL: VALID_ENV.SEED_USER_1_EMAIL },
      { ...VALID_ENV, SEED_USER_2_PASSWORD: '' },
      { ...VALID_ENV, NODE_ENV: 'production' },
    ].map((env) => failureFor(env).message);

    for (const message of messages) {
      for (const secret of secrets) expect(message).not.toContain(secret);
    }
  });
});
