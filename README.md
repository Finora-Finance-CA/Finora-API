# Finora-API

Express API for Finora, a personal finance and budgeting app.

## Team
Syed Kazmi, Usayd Jahangiri, Ayaan Sethi

## Tech Stack
- Node.js 22 and Express
- PostgreSQL on Supabase, accessed with `pg` (plain SQL, no ORM)
- Supabase Auth for sign-up and login; the API verifies Supabase access tokens
- Vitest and Supertest for tests

## Getting Started

```bash
nvm use
npm install
cp .env.example .env
```

On Windows, nvm-windows ignores `.nvmrc`, so run `nvm use 22` instead of `nvm use`. In PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Fill in `.env` (real values are in the team's credential document):

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase **Session pooler** connection string, with the password filled in |
| `SUPABASE_URL` | Yes | `https://<project-id>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | The project's publishable key (`sb_publishable_...`) |
| `PORT` | No | `4000` (also the default if left empty). The front-end's Vite proxy expects this port. |
| `CLIENT_ORIGIN` | No | `http://localhost:5173`. Not used yet. Reserved for CORS. |

The server will not start without the three required variables. The shared database is already migrated, so you don't need to run `npm run migrate` to get started.

Then start the server:

```bash
npm run dev
```

Check http://localhost:4000/health returns `{ "status": "ok", "database": "ok" }`. If it returns `503`, the API is running but can't reach the database: check `DATABASE_URL`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and restarts it on save |
| `npm start` | Starts the API without watching |
| `npm test` | Runs the tests once (no database or `.env` needed) |
| `npm run migrate` | Applies any new database migrations |
| `npm run seed` | Loads two sample users with three months of transactions (see [Sample data](#sample-data)) |

## Switching to Supabase Auth: what to do after pulling
The temporary JWT auth has been replaced by Supabase Auth. After pulling `develop`:

1. Run `npm install` (`jsonwebtoken` and `bcryptjs` were removed; `@supabase/supabase-js` was added).
2. In `.env`, delete `JWT_SECRET` and add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
3. You don't need to run migrations: `003_use_supabase_auth_users.sql` is already applied to the shared database. Running `npm run migrate` is safe and will report nothing new.
4. `npm run dev:token` no longer exists. To get a token for testing, see "Testing with a real token" below.

Migration `003` moved `transactions.user_id` to reference `auth.users(id)`, dropped our `public.users` table, and deleted old test transactions that belonged to dev-token users.

## Authentication
Users sign up and log in through Supabase Auth in the front-end. Protected endpoints need the user's Supabase access token:

```http
Authorization: Bearer <supabase access token>
```

`src/middleware/requireAuth.js` verifies the token with Supabase (`src/auth/supabaseTokens.js`, using `getClaims`) and sets `req.user = { id }`, where `id` is the token's `sub` claim: the Supabase user id (`auth.users.id`, a UUID). Only tokens for signed-in users (`role` of `authenticated`) are accepted. Routes should always take the user from `req.user.id`, never from the request body.

Missing, invalid or expired tokens get `401` with `{ "error": "..." }` and a `WWW-Authenticate: Bearer` header. If Supabase can't be reached, the request fails with `500`.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be set, or the server will not start. Only the publishable key is used; the secret key must never be added here.

Routes and middleware can throw `HttpError(status, message)`, `UnauthorizedError(message)` or `NotFoundError(message)` from `src/errors.js`, and the central error handler sends `{ "error": message }` with that status.

### Testing with a real token
1. Run the front-end and log in.
2. In DevTools → Network, open any `/api/...` request and copy the `Authorization` header value.
3. Use it with curl:

```bash
curl -i -X POST http://localhost:4000/api/transactions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount_cents":1250,"date":"2026-10-06","type":"expense","category":"Food"}'
```

Tokens expire after about an hour. Refresh the front-end to get a new one.

## Database Migrations
Schema changes are plain SQL files in `db/migrations/`, named `NNN_description.sql` (for example `002_create_transactions.sql`). They are applied in filename order.

Run pending migrations against the database in `DATABASE_URL`:

```bash
npm run migrate
```

Each migration runs in its own transaction and is recorded in the `schema_migrations` table, so running the command again only applies new files. If a migration fails, it is rolled back and nothing after it runs.

To add a migration:

1. Create `db/migrations/NNN_description.sql` using the next unused number, lowercase with underscores.
2. Write plain SQL only. Don't add `BEGIN`/`COMMIT`; the runner wraps each file in a transaction.
3. Never edit a migration that has already been applied. Add a new one instead.

`src/db.js` exports the shared `pg` pool and a `query(text, params)` helper. SSL is turned on automatically for any host other than localhost. Don't add `sslmode` to `DATABASE_URL`. If the database password contains special characters such as `@`, `#` or `/`, URL-encode them in `DATABASE_URL`.

## Tests

```bash
npm test
```

Runs every `test/**/*.test.js` file once with Vitest and exits. The tests never touch the shared database or Supabase, so they need no `.env` and are safe to run any time:

- `test/setup.js` runs before every test file. It replaces `src/db.js` with an in-memory database (`test/support/fakeDatabase.js`) and Supabase token checks with fixed test users (`test/support/fakeAuth.js`), and resets both before each test.
- `vitest.config.js` also blanks `DATABASE_URL` and the Supabase variables during tests, so anything that slipped past the fakes would fail instead of connecting.
- HTTP tests use Supertest against `createApp()` from `src/app.js`, with `ALICE` and `BOB` as logged-in users: `request(app).get('/api/transactions').set('Authorization', bearer(ALICE))`.
- The fake database runs the app's simple SQL (SELECT, INSERT, UPDATE and DELETE with `column = $n` conditions) and applies exactly the conditions written, so ownership checks are really tested. A new kind of statement throws until it's supported in `fakeDatabase.js`.

| Folder | What it covers |
| --- | --- |
| `test/transactions/` | Validation rules, and every `/api/transactions` endpoint: success, 400, 401, 404, ownership and database failures |
| `test/seed/` | The seed script's data, settings, Supabase sign-in/sign-up handling, database writes and the full run |
| `test/health.test.js` | `/health` with the database up and down |
| `test/setup.test.js` | That the fakes are really installed |

### CI
`.github/workflows/test.yml` runs `npm ci` and `npm test` on Node 22 (from `.nvmrc`) for every push and every pull request. It needs no secrets. A pull request should only be merged when this check passes.

## Sample data

```bash
npm run seed
```

Creates or reuses two sample users and gives each about 28 transactions from the last three months, covering every category plus income. Use them to log in to the front-end and try the app with realistic data.

### Setup
Add these to `.env` (they're listed in `.env.example`):

| Variable | Value |
| --- | --- |
| `SEED_USER_1_EMAIL`, `SEED_USER_2_EMAIL` | Two different addresses you control, for example `you+finora1@gmail.com` and `you+finora2@gmail.com` |
| `SEED_USER_1_PASSWORD`, `SEED_USER_2_PASSWORD` | At least 8 characters. These are the passwords you'll log in with. |

`DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be set too. Never commit real sample passwords.

### What it does
1. Refuses to run if `NODE_ENV` is `production`, and stops with a list of any missing variables.
2. Signs in each sample user through Supabase Auth with the publishable key. If the account doesn't exist yet, it's created with normal sign-up, so email confirmation must be off (it is for this project).
3. In one database transaction, deletes those two users' transactions and inserts the sample set. If anything fails, nothing is changed.
4. Prints a summary: each user, whether the account was created or already existed, and how many transactions were loaded.

Running it again gives the same result: the two sample users end up with the same sample transactions (dated relative to today) and nobody else's data is touched. Any changes you made to the sample users' transactions are replaced.

### If it fails
Every failure prints `Seed failed: ...` with what to do, and exits with code 1 without writing any transactions.

| Message | What to do |
| --- | --- |
| `Missing SEED_USER_1_EMAIL, ...` | Add the listed variables to `.env`. |
| `... already exists, but its password doesn't match` | Put that account's real password in `.env`, or use a different sample email. |
| `Supabase is rate limiting ...` | Wait a few minutes and run it again. |
| `Supabase rejected sign up ...` | Supabase's reason follows, for example an email domain it won't accept. Use a different address. |
| `... has to confirm their email` | Email confirmation was turned on in Supabase. Turn it off, or confirm the address, then run it again. |
| `Could not reach Supabase ...` | Check `SUPABASE_URL` and your connection. |

## API

All request and response bodies are JSON. Errors use one of two shapes:

- `400`: `{ "errors": { "<field>": "<message>" } }`, listing every invalid field at once. A body that isn't valid JSON is reported under `body`, and a bad `:id` in the URL under `id`.
- `401`, `404`, `500` and other errors: `{ "error": "<message>" }`. A `500` never includes internal details.

`GET /health` is the one exception, and uses its own shape (below).

### `GET /health`
Public: no token needed. Checks that the API is running and can reach the database with a read-only `SELECT 1`. The response is never cached.

`200 OK` when the database answers:

```json
{ "status": "ok", "database": "ok" }
```

`503 Service Unavailable` when the database can't be reached or takes longer than 3 seconds. The reason is logged by the API, not sent in the response.

```json
{ "status": "error", "database": "unreachable" }
```

Supabase Auth is not checked here.

### `GET /api/transactions`
Lists the logged-in user's 50 most recent transactions, newest first: by `date`, then by when they were created. Other users' transactions are never included. Paging, search and filters are not supported yet (Sprint 2).

Headers:

```http
Authorization: Bearer <supabase access token>
```

`200 OK`:

```json
{
  "transactions": [
    {
      "id": "42",
      "user_id": "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      "amount_cents": 1250,
      "date": "2026-10-05",
      "type": "expense",
      "category": "Food",
      "description": "Lunch",
      "created_at": "2026-10-05T18:30:00.000Z",
      "updated_at": "2026-10-05T18:30:00.000Z"
    }
  ]
}
```

A user with no transactions gets `{ "transactions": [] }`.

`401 Unauthorized`, when the token is missing, invalid or expired:

```json
{ "error": "Authentication required. Send an Authorization: Bearer <token> header." }
```

`500 Internal Server Error`:

```json
{ "error": "Something went wrong. Please try again later." }
```

### `POST /api/transactions`
Creates a transaction for the logged-in user.

Headers:

```http
Authorization: Bearer <supabase access token>
Content-Type: application/json
```

Body:

| Field | Required | Rules |
| --- | --- | --- |
| `amount_cents` | Yes | Integer number of cents, greater than 0 and at most 2147483647. `1250` means $12.50. Decimals and strings are rejected. |
| `date` | Yes | Real calendar date as `YYYY-MM-DD`, year 1900 or later. |
| `type` | Yes | `income` or `expense`. |
| `category` | For `expense` | One of `Food`, `Transportation`, `Housing`, `Entertainment`, `Other` (case-sensitive). Optional for `income`. |
| `description` | No | String, trimmed, at most 255 characters. Empty becomes `null`. |

Any other fields, including `user_id`, are ignored.

Example request:

```json
{
  "amount_cents": 1250,
  "date": "2026-10-05",
  "type": "expense",
  "category": "Food",
  "description": "Lunch"
}
```

`201 Created`:

```json
{
  "transaction": {
    "id": "42",
    "user_id": "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    "amount_cents": 1250,
    "date": "2026-10-05",
    "type": "expense",
    "category": "Food",
    "description": "Lunch",
    "created_at": "2026-10-05T18:30:00.000Z",
    "updated_at": "2026-10-05T18:30:00.000Z"
  }
}
```

`id` is a string because the column is a `BIGINT`.

`400 Bad Request`:

```json
{
  "errors": {
    "amount_cents": "amount_cents must be greater than zero.",
    "category": "category is required for an expense."
  }
}
```

`401 Unauthorized`, when the token is missing, invalid or expired, or the user's account has since been deleted:

```json
{ "error": "Authentication required. Send an Authorization: Bearer <token> header." }
```

`500 Internal Server Error`:

```json
{ "error": "Something went wrong. Please try again later." }
```

### `PUT /api/transactions/:id`
Replaces a transaction owned by the logged-in user. `:id` is the transaction's `id`.

Headers:

```http
Authorization: Bearer <supabase access token>
Content-Type: application/json
```

Body: the same fields and rules as [`POST /api/transactions`](#post-apitransactions). Every field is replaced, so send the whole transaction. An optional field that is left out (`description`, or `category` on an `income`) is cleared to `null`. Any other fields, including `id` and `user_id`, are ignored.

Example request to `PUT /api/transactions/42`:

```json
{
  "amount_cents": 1500,
  "date": "2026-10-05",
  "type": "expense",
  "category": "Food",
  "description": "Lunch and coffee"
}
```

`200 OK` with the updated transaction. `updated_at` is set to the time of the update.

```json
{
  "transaction": {
    "id": "42",
    "user_id": "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    "amount_cents": 1500,
    "date": "2026-10-05",
    "type": "expense",
    "category": "Food",
    "description": "Lunch and coffee",
    "created_at": "2026-10-05T18:30:00.000Z",
    "updated_at": "2026-10-06T09:15:00.000Z"
  }
}
```

`400 Bad Request`, listing a bad `id` together with any invalid body fields:

```json
{
  "errors": {
    "id": "id must be a positive whole number.",
    "amount_cents": "amount_cents must be greater than zero."
  }
}
```

`401 Unauthorized`, when the token is missing, invalid or expired:

```json
{ "error": "Authentication required. Send an Authorization: Bearer <token> header." }
```

`404 Not Found`, when no transaction with that id exists or it belongs to another user. The response is the same in both cases, so other users' ids can't be discovered.

```json
{ "error": "Transaction not found." }
```

`500 Internal Server Error`:

```json
{ "error": "Something went wrong. Please try again later." }
```

### `DELETE /api/transactions/:id`
Deletes a transaction owned by the logged-in user. `:id` is the transaction's `id`.

Headers:

```http
Authorization: Bearer <supabase access token>
```

`204 No Content` on success, with an empty body.

`400 Bad Request`, when `:id` is not a positive whole number:

```json
{ "errors": { "id": "id must be a positive whole number." } }
```

`401 Unauthorized`, when the token is missing, invalid or expired:

```json
{ "error": "Authentication required. Send an Authorization: Bearer <token> header." }
```

`404 Not Found`, when no transaction with that id exists or it belongs to another user. The response is the same in both cases.

```json
{ "error": "Transaction not found." }
```

`500 Internal Server Error`:

```json
{ "error": "Something went wrong. Please try again later." }
```

## Workflow
- `main` is always stable. Never push directly to it.
- Open a pull request and get one teammate's review before merging
- Reference the user story in your PR (e.g. "US-04: Add income event")

## Related Repos
- [Finora-FrontEnd](https://github.com/Finora-Finance-CA/Finora-FrontEnd)
