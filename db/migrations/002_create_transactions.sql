-- US-10: transactions owned by a user. Money is stored as integer cents, never floats.

CREATE TABLE public.transactions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  date         DATE NOT NULL,
  type         TEXT NOT NULL,
  category     TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transactions_amount_cents_positive CHECK (amount_cents > 0),
  CONSTRAINT transactions_type_valid CHECK (type IN ('income', 'expense')),
  CONSTRAINT transactions_category_valid CHECK (
    category IN ('Food', 'Transportation', 'Housing', 'Entertainment', 'Other')
  ),
  CONSTRAINT transactions_expense_requires_category CHECK (
    type <> 'expense' OR category IS NOT NULL
  )
);

-- Lists one user's transactions newest first. Also serves the user_id foreign key.
CREATE INDEX transactions_user_id_date_idx ON public.transactions (user_id, date DESC);

CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No policies: blocks Supabase's auto-generated API; the API's direct connection is unaffected.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
