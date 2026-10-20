-- US-31, US-33: a monthly spending limit per expense category, owned by a user.
-- Each user has at most one budget per category. Money is integer cents, never floats.
--
-- The constraint names below are used by src/routes/budgets.js to turn database errors
-- into 400 and 409 responses; test/migrations.test.js checks they match.

CREATE TABLE public.budgets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL,
  category    TEXT NOT NULL,
  limit_cents INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deleting a user deletes their budgets, as with transactions.
  CONSTRAINT budgets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Renaming a category updates its budgets; a category with budgets can't be deleted.
  CONSTRAINT budgets_category_fkey
    FOREIGN KEY (category) REFERENCES public.categories (name) ON UPDATE CASCADE,
  CONSTRAINT budgets_limit_cents_positive CHECK (limit_cents > 0),
  -- One budget per category per user. Its index also serves "this user's budgets".
  CONSTRAINT budgets_user_id_category_key UNIQUE (user_id, category)
);

-- Keeps updated_at current, with the shared function from 001.
CREATE TRIGGER budgets_set_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No policies: blocks Supabase's auto-generated API; the API's direct connection is unaffected.
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
