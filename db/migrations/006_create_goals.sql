-- US-47: savings goals owned by a user: a name, a target and an optional date to reach
-- it by. Money is integer cents, never floats.
--
-- The constraint names below are used by src/routes/goals.js to turn database errors
-- into 400 and 401 responses; test/migrations.test.js checks they match.

CREATE TABLE public.goals (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL,
  name         TEXT NOT NULL,
  target_cents BIGINT NOT NULL,
  -- What has been put towards the goal so far. Only contributions (US-49) change it.
  saved_cents  BIGINT NOT NULL DEFAULT 0,
  target_date  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deleting a user deletes their goals, as with transactions and budgets.
  CONSTRAINT goals_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT goals_target_cents_positive CHECK (target_cents > 0),
  CONSTRAINT goals_saved_cents_nonnegative CHECK (saved_cents >= 0),
  CONSTRAINT goals_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

-- Serves "this user's goals" and the user_id foreign key.
CREATE INDEX goals_user_id_idx ON public.goals (user_id);

-- Keeps updated_at current, with the shared function from 001.
CREATE TRIGGER goals_set_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No policies: blocks Supabase's auto-generated API; the API's direct connection is unaffected.
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
