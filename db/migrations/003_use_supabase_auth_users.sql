-- Transactions now belong to Supabase Auth users (auth.users) instead of our own
-- public.users table, which is no longer needed.

-- Test transactions owned by users that don't exist in Supabase Auth can't be
-- linked to anyone, so remove them first.
DELETE FROM public.transactions t
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id = t.user_id
);

-- Swap the foreign key from public.users to auth.users. Deleting a user still
-- deletes their transactions.
ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_user_id_fkey;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- Replaced by Supabase Auth. The shared set_updated_at() function from 001 stays,
-- because transactions still uses it.
DROP TABLE public.users;