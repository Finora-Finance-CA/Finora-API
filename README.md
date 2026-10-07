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
| `npm test` | Runs the tests once |
| `npm run migrate` | Applies any new database migrations |

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

Routes and middleware can throw `HttpError(status, message)` or `UnauthorizedError(message)` from `src/errors.js`, and the central error handler sends `{ "error": message }` with that status.

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

## API

All request and response bodies are JSON. Errors use one of two shapes:

- `400`: `{ "errors": { "<field>": "<message>" } }`, listing every invalid field at once. A body that isn't valid JSON is reported under `body`.
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

## Workflow
- `main` is always stable. Never push directly to it.
- Open a pull request and get one teammate's review before merging
- Reference the user story in your PR (e.g. "US-04: Add income event")

## Related Repos
- [Finora-FrontEnd](https://github.com/Finora-Finance-CA/Finora-FrontEnd)
