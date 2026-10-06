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

## Workflow
- `main` is always stable. Never push directly to it.
- Open a pull request and get one teammate's review before merging
- Reference the user story in your PR (e.g. "US-04: Add income event")

## Related Repos
- [Finora-FrontEnd](https://github.com/Finora-Finance-CA/Finora-FrontEnd)

Ayaan Test!