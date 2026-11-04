// The ownership check used by the route tests catches a missing owner check, even when
// user_id is still named elsewhere in the statement.

import { describe, expect, it } from 'vitest';
import { ownerCheckProblem } from './ownership.js';

const ME = 'user-a';
const OTHER = 'user-b';
const statement = (sql, params) => ({ sql, params });

describe('ownerCheckProblem', () => {
  it.each([
    ['a scoped SELECT', 'SELECT id FROM public.budgets WHERE user_id = $1', [ME]],
    ['a scoped SELECT with more conditions', 'SELECT category, SUM(amount_cents) AS spent_cents FROM public.transactions WHERE user_id = $1 AND type = $2 AND date >= $3 GROUP BY category', [ME, 'expense', '2026-10-01']],
    ['a scoped UPDATE', 'UPDATE public.goals SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id, user_id', ['7', ME, 'Trip']],
    ['a scoped DELETE', 'DELETE FROM public.transactions WHERE id = $1 AND user_id = $2', ['7', ME]],
    ['an INSERT for the user', 'INSERT INTO public.budgets (user_id, category, limit_cents) VALUES ($1, $2, $3) RETURNING id', [ME, 'Food', 1]],
    ['a statement on another table', 'SELECT 1 FROM public.schema_migrations', []],
  ])('accepts %s', (_, sql, params) => {
    expect(ownerCheckProblem(statement(sql, params), ME)).toBeNull();
  });

  it.each([
    ['user_id only in the returned columns', 'UPDATE public.goals SET name = $2 WHERE id = $1 RETURNING id, user_id, name', ['7', 'Trip']],
    ['user_id only in the select list', 'SELECT id, user_id FROM public.budgets', []],
    ['an owner check for someone else', 'DELETE FROM public.transactions WHERE id = $1 AND user_id = $2', ['7', OTHER]],
    ['user_id compared to something other than a parameter', 'SELECT id FROM public.budgets WHERE user_id = user_id', []],
    ['an OR that would let other rows through', 'SELECT id FROM public.budgets WHERE user_id = $1 OR id = $2', [ME, '1']],
    ['an INSERT for someone else', 'INSERT INTO public.goals (user_id, name) VALUES ($1, $2)', [OTHER, 'Trip']],
    ['an INSERT without user_id', 'INSERT INTO public.goals (name) VALUES ($1)', ['Trip']],
  ])('flags %s', (_, sql, params) => {
    expect(ownerCheckProblem(statement(sql, params), ME)).not.toBeNull();
  });
});
