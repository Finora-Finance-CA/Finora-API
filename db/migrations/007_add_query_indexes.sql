-- US-62 (NFR-06): indexes that match the queries the API runs, so the transactions page
-- and the dashboard stay fast with thousands of transactions per user. Safe to run again:
-- every statement uses IF NOT EXISTS or IF EXISTS. test/migrations.test.js checks this file,
-- and test/integration/queryPlans.test.js checks on real Postgres that the queries use it.
--
-- What each query needs (src/*/repository.js):
--
-- 1. The transaction list (GET /api/transactions): WHERE user_id = $1 [AND date range]
--    ORDER BY date DESC, created_at DESC, id DESC LIMIT 20 OFFSET n, plus a COUNT(*) with
--    the same WHERE. An index in exactly that order gives each page straight from the
--    index with no sort, and the COUNT from the index alone. INCLUDE also lets the monthly
--    summary (SUM by type for a date range) read only the index.
CREATE INDEX IF NOT EXISTS transactions_user_list_idx
  ON public.transactions (user_id, date DESC, created_at DESC, id DESC)
  INCLUDE (type, category, amount_cents);

-- 2. The list filtered by category (category = ANY($n)): the user's rows in those
--    categories, newest first.
CREATE INDEX IF NOT EXISTS transactions_user_category_date_idx
  ON public.transactions (user_id, category, date DESC);

-- 3. Expense totals for a date range (budget status, the dashboard's spending by category
--    and its 6-month trend): WHERE user_id = $1 AND type = 'expense' AND date >= $3 AND
--    date < $4, summed by category or by day. Read from the index alone.
CREATE INDEX IF NOT EXISTS transactions_user_type_date_idx
  ON public.transactions (user_id, type, date)
  INCLUDE (category, amount_cents);

-- Migration 002's (user_id, date DESC) is a prefix of index 1, which now does all of its
-- work, including the user_id foreign key's lookups. Keeping both would only slow writes.
DROP INDEX IF EXISTS public.transactions_user_id_date_idx;

-- 4. Goals (GET /api/goals): WHERE user_id = $1 ORDER BY created_at DESC, id DESC. This
--    replaces 006's goals_user_id_idx (user_id), which is a prefix of it.
CREATE INDEX IF NOT EXISTS goals_user_created_idx
  ON public.goals (user_id, created_at DESC, id DESC);

DROP INDEX IF EXISTS public.goals_user_id_idx;

-- Budgets need nothing new: every budget query filters by user_id, which the unique
-- (user_id, category) index from 005 already serves.
--
-- Search (description ILIKE '%text%') gets no index, on purpose. A trigram index
-- (pg_trgm, GIN) is the only kind that helps a contains-search, but the search always
-- runs on one user's transactions, which index 1 finds first; checking even 10,000
-- descriptions after that is a few milliseconds. A trigram index over every user's
-- descriptions would add an extension, slow every insert and update, and save nothing
-- at this size. Revisit if one user ever has hundreds of thousands of transactions.

-- Fresh statistics, so the planner chooses the new indexes straight away.
ANALYZE public.transactions;
ANALYZE public.goals;
