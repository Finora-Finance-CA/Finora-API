-- Users who own transactions. Registration and login (US-01 to US-05) build on this table.

-- Shared trigger function that keeps updated_at current. Defined once here and
-- reused by every table that has an updated_at column.
CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: Alice@Example.com and alice@example.com are the same user.
CREATE UNIQUE INDEX users_email_lower_key ON public.users (lower(email));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The API connects directly with DATABASE_URL and is unaffected. With no policies,
-- this blocks all access through Supabase's auto-generated API.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
