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

describe('007_add_query_indexes.sql (US-62)', () => {
  const sql = () => migration('007_add_query_indexes.sql');
  const statements = async () =>
    (await sql())
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

  it('is safe to run again: every CREATE uses IF NOT EXISTS and every DROP uses IF EXISTS', async () => {
    for (const statement of await statements()) {
      if (/^CREATE INDEX/i.test(statement)) expect(statement).toMatch(/^CREATE INDEX IF NOT EXISTS /i);
      if (/^DROP INDEX/i.test(statement)) expect(statement).toMatch(/^DROP INDEX IF EXISTS /i);
    }
  });

  it('indexes the transaction list in its exact order, with what the monthly totals read', async () => {
    expect(await sql()).toMatch(
      /CREATE INDEX IF NOT EXISTS transactions_user_list_idx\s+ON public\.transactions \(user_id, date DESC, created_at DESC, id DESC\)\s+INCLUDE \(type, category, amount_cents\)/
    );
  });

  it('indexes the category filter and the expense totals', async () => {
    const text = await sql();
    expect(text).toMatch(/transactions_user_category_date_idx\s+ON public\.transactions \(user_id, category, date DESC\)/);
    expect(text).toMatch(/transactions_user_type_date_idx\s+ON public\.transactions \(user_id, type, date\)\s+INCLUDE \(category, amount_cents\)/);
  });

  it('indexes goals in the order they are listed, and drops the indexes the new ones replace', async () => {
    const text = await sql();
    expect(text).toMatch(/goals_user_created_idx\s+ON public\.goals \(user_id, created_at DESC, id DESC\)/);
    expect(text).toMatch(/DROP INDEX IF EXISTS public\.transactions_user_id_date_idx;/);
    expect(text).toMatch(/DROP INDEX IF EXISTS public\.goals_user_id_idx;/);
  });

  it('adds no extension and no CONCURRENTLY, which can’t run inside the runner’s transaction', async () => {
    const text = (await statements()).join('\n');
    expect(text).not.toMatch(/CREATE EXTENSION|CONCURRENTLY/i);
    expect(text).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);
  });
});
