// The owner check every statement on a user's table must make (US-45), read from the
// statements the fake database recorded.
//
// SELECT, UPDATE and DELETE need `user_id = $n` as one of the WHERE clause's AND-ed
// conditions, with $n bound to the logged-in user's id. INSERT needs user_id in its
// column list, with that user's id as the value. Naming user_id anywhere else (e.g. in
// the columns a query returns) doesn't count.

import { expect } from 'vitest';

// Tables that hold one user's data. A new one must be added here.
export const USER_TABLES = Object.freeze(['transactions', 'budgets', 'goals']);

// Where a WHERE clause ends in the SQL the app sends.
const WHERE_PATTERN = /\bWHERE (.+?)(?: GROUP BY | ORDER BY | LIMIT | OFFSET | RETURNING |$)/i;

const paramAt = (params, ref) => params[Number(ref) - 1];

function insertProblem(sql, params, userId) {
  const match = /^INSERT INTO public\.\w+ \(([^)]*)\) VALUES (.+?)(?: RETURNING .+)?$/i.exec(sql);
  if (!match) return 'INSERT in an unexpected form';
  const column = match[1].split(',').map((name) => name.trim()).indexOf('user_id');
  if (column === -1) return 'INSERT without a user_id column';
  for (const [, group] of match[2].matchAll(/\(([^)]*)\)/g)) {
    const ref = /^\$(\d+)$/.exec(group.split(',')[column].trim())?.[1];
    if (!ref || paramAt(params, ref) !== userId) return 'INSERT with a user_id that is not the logged-in user';
  }
  return null;
}

function whereProblem(sql, params, userId) {
  const where = WHERE_PATTERN.exec(sql)?.[1];
  if (!where) return 'no WHERE clause';
  const owned = where
    .split(/ AND /i)
    .map((condition) => /^user_id = \$(\d+)$/.exec(condition.trim())?.[1])
    .some((ref) => ref && paramAt(params, ref) === userId);
  return owned ? null : 'no user_id = $n condition for the logged-in user in its WHERE clause';
}

/**
 * Why a statement doesn't limit itself to `userId`'s rows, or null if it does (or it
 * isn't on a user's table).
 *
 * @param {{ sql: string, params: unknown[] }} statement As recordedQueries() returns it.
 * @param {string} userId
 * @returns {string|null}
 */
export function ownerCheckProblem({ sql, params }, userId) {
  const table = /\b(?:FROM|INTO|UPDATE) public\.(\w+)/i.exec(sql)?.[1];
  if (!USER_TABLES.includes(table)) return null;
  return /^INSERT\b/i.test(sql) ? insertProblem(sql, params, userId) : whereProblem(sql, params, userId);
}

/** Fails, naming the statement, unless every one is limited to `userId`'s rows. */
export function expectEveryStatementOwnedBy(statements, userId) {
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    expect(ownerCheckProblem(statement, userId), statement.sql).toBeNull();
  }
}
