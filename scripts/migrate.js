// Applies pending SQL migrations from db/migrations in filename order.
// Each migration runs in its own transaction and is recorded in schema_migrations,
// so running this again only applies new files.
//
// Usage: npm run migrate

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const MIGRATION_FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;

async function listMigrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const seenNumbers = new Map();

  for (const file of files) {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (!match) {
      throw new Error(`Invalid migration filename "${file}". Expected NNN_description.sql (lowercase).`);
    }
    const number = match[1];
    if (seenNumbers.has(number)) {
      throw new Error(`Migrations "${seenNumbers.get(number)}" and "${file}" share the number ${number}.`);
    }
    seenNumbers.set(number, file);
  }

  return files;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Keep the migration history out of Supabase's auto-generated API too.
  await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
}

async function applyMigration(client, file) {
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

  await client.query('BEGIN');
  try {
    // Serialises concurrent runners: a second runner waits here, then sees the
    // migration as already applied and skips it.
    await client.query('LOCK TABLE public.schema_migrations IN EXCLUSIVE MODE');
    const { rowCount } = await client.query(
      'SELECT 1 FROM public.schema_migrations WHERE filename = $1',
      [file]
    );
    if (rowCount > 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`, { cause: err });
  }
}

async function migrate() {
  const files = await listMigrationFiles();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT filename FROM public.schema_migrations');
    const applied = new Set(rows.map((row) => row.filename));
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log('No pending migrations. Database is up to date.');
      return;
    }

    for (const file of pending) {
      const ran = await applyMigration(client, file);
      console.log(ran ? `Applied ${file}` : `Skipped ${file} (applied by another run)`);
    }
    console.log('Migrations complete.');
  } finally {
    client.release();
  }
}

try {
  await migrate();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
