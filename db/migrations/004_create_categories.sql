-- US-18: the category list lives in the database, and every transaction's category
-- must be one of its rows. Replaces the hard-coded CHECK from 002.
--
-- The names below must match CATEGORIES in src/constants.js (a test checks this).

CREATE TABLE public.categories (
  name       TEXT PRIMARY KEY,
  -- Order the categories are listed in, e.g. in the front-end's dropdown.
  sort_order SMALLINT NOT NULL UNIQUE
);

INSERT INTO public.categories (name, sort_order) VALUES
  ('Food', 1),
  ('Transportation', 2),
  ('Housing', 3),
  ('Entertainment', 4),
  ('Other', 5);

-- The CHECK allowed exactly these five names, so every existing row already has a
-- category in the new table (or none), and the foreign key can be added safely.
ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_category_valid;

-- A NULL category (allowed for income) is not checked. Renaming a category updates
-- its transactions; a category still in use can't be deleted.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_category_fkey
  FOREIGN KEY (category) REFERENCES public.categories (name) ON UPDATE CASCADE;

-- No policies: blocks Supabase's auto-generated API; the API's direct connection is unaffected.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
