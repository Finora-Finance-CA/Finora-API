// The routes turn database errors into 400 and 409 responses by constraint name. These
// fail if a migration and the names the code expects ever drift apart.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BUDGET_CONSTRAINTS } from '../src/routes/budgets.js';
import { GOAL_CONSTRAINTS } from '../src/routes/goals.js';

const migration = (file) => readFile(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8');

describe('005_create_budgets.sql', () => {
  it.each(Object.entries(BUDGET_CONSTRAINTS))('names the %s constraint %s, as the budget routes expect', async (_, name) => {
    expect(await migration('005_create_budgets.sql')).toMatch(new RegExp(`CONSTRAINT ${name}\\b`));
  });

  it('keeps updated_at current and blocks Supabase’s auto-generated API, like the other tables', async () => {
    const sql = await migration('005_create_budgets.sql');

    expect(sql).toMatch(/CREATE TRIGGER budgets_set_updated_at\s+BEFORE UPDATE ON public\.budgets/);
    expect(sql).toMatch(/EXECUTE FUNCTION public\.set_updated_at\(\)/);
    expect(sql).toMatch(/ALTER TABLE public\.budgets ENABLE ROW LEVEL SECURITY/);
  });

  it('allows only one budget per category per user, with a positive limit', async () => {
    const sql = await migration('005_create_budgets.sql');

    expect(sql).toMatch(/UNIQUE \(user_id, category\)/);
    expect(sql).toMatch(/CHECK \(limit_cents > 0\)/);
    expect(sql).toMatch(/REFERENCES auth\.users \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/REFERENCES public\.categories \(name\)/);
  });
});

describe('006_create_goals.sql', () => {
  it.each(Object.entries(GOAL_CONSTRAINTS))('names the %s constraint %s, as the goal routes expect', async (_, name) => {
    expect(await migration('006_create_goals.sql')).toMatch(new RegExp(`CONSTRAINT ${name}\\b`));
  });

  it('keeps updated_at current and blocks Supabase’s auto-generated API, like the other tables', async () => {
    const sql = await migration('006_create_goals.sql');

    expect(sql).toMatch(/CREATE TRIGGER goals_set_updated_at\s+BEFORE UPDATE ON public\.goals/);
    expect(sql).toMatch(/EXECUTE FUNCTION public\.set_updated_at\(\)/);
    expect(sql).toMatch(/ALTER TABLE public\.goals ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE INDEX goals_user_id_idx ON public\.goals \(user_id\)/);
  });

  it('has a positive target, a saved total that starts at 0, and a 1 to 60 character name', async () => {
    const sql = await migration('006_create_goals.sql');

    expect(sql).toMatch(/CHECK \(target_cents > 0\)/);
    expect(sql).toMatch(/saved_cents\s+BIGINT NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/CHECK \(saved_cents >= 0\)/);
    expect(sql).toMatch(/CHECK \(char_length\(btrim\(name\)\) BETWEEN 1 AND 60\)/);
    expect(sql).toMatch(/REFERENCES auth\.users \(id\) ON DELETE CASCADE/);
  });

  it('wraps nothing in BEGIN or COMMIT, since the runner does that', async () => {
    expect(await migration('006_create_goals.sql')).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);
  });
});

describe('004_create_categories.sql', () => {
  it('names the category foreign key the transaction routes expect', async () => {
    expect(await migration('004_create_categories.sql')).toMatch(/CONSTRAINT transactions_category_fkey\b/);
  });
});
