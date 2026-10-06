# Finora-API

Finora is a finance and budget tracking app built.

## Team
Syed Kazmi, Usayd, Ayaan

## Tech Stack
TBD

## Getting Started
Setup instructions coming soon.

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

## Authentication
Protected endpoints need a JSON Web Token in the `Authorization` header:

```http
Authorization: Bearer <token>
```

Tokens are JWTs signed with `JWT_SECRET` using HS256, with these claims:

- `sub`: the user's id (`users.id`, a UUID).
- `type`: always `"access"`. Tokens of any other type signed with the same secret (for example a future refresh token) are rejected, so they can never be used to call the API.
- `exp`: expiry, 1 hour by default. Tokens without one are rejected.

The API always takes the user from the token, never from the request body. `JWT_SECRET` must be set or the server will not start, and it should be at least 32 bytes of random data.

`src/auth/tokens.js` exports `signToken(userId, { expiresIn })` and `verifyToken(token)`. `src/middleware/requireAuth.js` checks the header and sets `req.user = { id }`. If the token is missing, malformed, tampered with or expired, the response is `401` with `{ "error": "..." }` and a `WWW-Authenticate: Bearer` header.

Routes and middleware can throw `HttpError(status, message)` or `UnauthorizedError(message)` from `src/errors.js`, and the central error handler sends `{ "error": message }` with that status.

This is minimal auth added for US-13. Registration, login and logout (US-01 to US-05) will build on it or replace it.

### Dev token script
Until login exists, get a token for testing with:

```bash
npm run dev:token -- someone@example.com
```

It finds the user with that email, or creates one, and prints a token valid for 1 hour. Users it creates get a placeholder `password_hash` that can never match a real password. The script refuses to run when `NODE_ENV` is `production`. It writes to the database in `DATABASE_URL`, so use a test email.

To capture the token in PowerShell:

```powershell
$token = npm run --silent dev:token -- someone@example.com
```

## API

All request and response bodies are JSON. Errors use one of two shapes:

- `400`: `{ "errors": { "<field>": "<message>" } }`, listing every invalid field at once.
- `401`, `404`, `500`: `{ "error": "<message>" }`. A `500` never includes internal details.

### `GET /health`
Returns `200` with `{ "status": "ok" }`.

### `POST /api/transactions`
Creates a transaction for the logged-in user.

Headers:

```http
Authorization: Bearer <token>
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

`401 Unauthorized`:

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

Ayaan Test!