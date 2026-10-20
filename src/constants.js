// Values shared across the API. Keep them here so there is one place to change each.

// Mirrors public.categories (db/migrations/004_create_categories.sql), in its
// sort_order. test/constants.test.js fails if the two drift apart. The front-end has
// its own copy in src/transactions/constants.js.
export const CATEGORIES = Object.freeze(['Food', 'Transportation', 'Housing', 'Entertainment', 'Other']);

// Mirrors the transactions_type_valid CHECK in db/migrations/002_create_transactions.sql.
export const TRANSACTION_TYPES = Object.freeze(['income', 'expense']);

// Largest value a Postgres INTEGER column (amount_cents) can hold.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

// How many transactions GET /api/transactions returns per page.
export const TRANSACTION_PAGE_SIZE = 20;
