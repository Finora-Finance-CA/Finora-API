// In-memory stand-in for src/db.js, installed for every test by test/setup.js.
//
// It runs the simple statements the app sends to public.transactions: SELECT, INSERT,
// UPDATE and DELETE, with `column = $n` and `column = ANY($n)` conditions joined by
// AND, plus ORDER BY, LIMIT, RETURNING and BEGIN/COMMIT/ROLLBACK. It applies exactly
// the conditions written in the SQL, so a query that lost its user_id check would
// expose other users' rows here too and the ownership tests would fail. Any other
// statement throws, so new SQL fails loudly until it's supported here.

import { vi } from 'vitest';

const CLOCK_START = Date.UTC(2026, 0, 1);

const state = {};

export function resetFakeDatabase() {
  Object.assign(state, {
    rows: [],
    nextId: 1,
    ticks: 0,
    snapshot: null,
    queries: [],
    failures: [],
    openClients: 0,
  });
  pingDatabase.mockReset();
  pingDatabase.mockResolvedValue(undefined);
}

/** Each call is one second after the last, so rows have a clear creation order. */
function nextTimestamp() {
  state.ticks += 1;
  return new Date(CLOCK_START + state.ticks * 1000).toISOString();
}

function newRow(values) {
  const timestamp = nextTimestamp();
  return {
    id: String(state.nextId++),
    user_id: null,
    amount_cents: null,
    date: null,
    type: null,
    category: null,
    description: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...values,
  };
}

/** Puts rows straight into the table, as if another request had created them. Returns copies. */
export function addRows(...rows) {
  const added = rows.map(newRow);
  state.rows.push(...added);
  return added.map((row) => ({ ...row }));
}

/** A copy of every row currently in the table. */
export function storedRows() {
  return state.rows.map((row) => ({ ...row }));
}

/** Every statement sent so far, whitespace-collapsed, with its parameters. */
export function recordedQueries() {
  return state.queries.map((entry) => ({ ...entry, params: [...entry.params] }));
}

/** Makes the next statement matching `pattern` throw `error` instead of running. */
export function failNextQuery(error, pattern = /.*/) {
  state.failures.push({ pattern, error });
}

/** Clients taken with pool.connect() that haven't been released yet. */
export function openClientCount() {
  return state.openClients;
}

const param = (params, ref) => params[Number(ref) - 1];

function rowMatcher(where, params) {
  const checks = where.split(/ AND /i).map((condition) => {
    const any = /^(\w+) = ANY\(\$(\d+)(?:::\w+\[\])?\)$/i.exec(condition);
    if (any) {
      const values = param(params, any[2]).map(String);
      return (row) => values.includes(String(row[any[1]]));
    }
    const equals = /^(\w+) = \$(\d+)$/.exec(condition);
    if (equals) {
      const value = String(param(params, equals[2]));
      return (row) => String(row[equals[1]]) === value;
    }
    throw new Error(`Fake database: unsupported condition "${condition}"`);
  });
  return (row) => checks.every((check) => check(row));
}

function columnList(text) {
  return text.split(',').map((column) => column.trim());
}

function pick(row, returning) {
  return Object.fromEntries(columnList(returning).map((column) => [column, row[column]]));
}

// Ids are digit strings (BIGINT comes back from pg as a string), so compare them as numbers.
function compareValues(a, b) {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const difference = BigInt(a) - BigInt(b);
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function rowComparator(orderBy) {
  const keys = orderBy.split(',').map((part) => {
    const [column, direction = 'ASC'] = part.trim().split(/\s+/);
    return { column, sign: direction.toUpperCase() === 'DESC' ? -1 : 1 };
  });
  return (a, b) => {
    for (const { column, sign } of keys) {
      const result = compareValues(a[column], b[column]);
      if (result !== 0) return result * sign;
    }
    return 0;
  };
}

function transactionControl([command]) {
  const keyword = command.toUpperCase();
  if (keyword === 'BEGIN') {
    if (state.snapshot) throw new Error('Fake database: BEGIN inside an open transaction');
    state.snapshot = { rows: state.rows.map((row) => ({ ...row })), nextId: state.nextId };
  } else if (keyword === 'ROLLBACK') {
    if (state.snapshot) Object.assign(state, state.snapshot);
    state.snapshot = null;
  } else {
    state.snapshot = null;
  }
  return { rows: [], rowCount: 0 };
}

function select([columns, where, orderBy, limitRef], params) {
  let rows = state.rows.filter(rowMatcher(where, params));
  if (orderBy) rows = [...rows].sort(rowComparator(orderBy));
  if (limitRef) rows = rows.slice(0, param(params, limitRef));
  return { rows: rows.map((row) => pick(row, columns)), rowCount: rows.length };
}

function insert([columns, values, returning], params) {
  const names = columnList(columns);
  const groups = [...values.matchAll(/\(([^)]*)\)/g)].map((match) => columnList(match[1]));
  const added = groups.map((refs) => {
    if (refs.length !== names.length) throw new Error('Fake database: INSERT column/value count mismatch');
    return newRow(Object.fromEntries(names.map((name, i) => [name, param(params, refs[i].slice(1))])));
  });
  state.rows.push(...added);
  return { rows: returning ? added.map((row) => pick(row, returning)) : [], rowCount: added.length };
}

function update([assignments, where, returning], params) {
  const changes = Object.fromEntries(
    columnList(assignments).map((assignment) => {
      const match = /^(\w+) = \$(\d+)$/.exec(assignment);
      if (!match) throw new Error(`Fake database: unsupported assignment "${assignment}"`);
      return [match[1], param(params, match[2])];
    })
  );
  const matches = state.rows.filter(rowMatcher(where, params));
  // Mirrors the transactions_set_updated_at trigger.
  for (const row of matches) Object.assign(row, changes, { updated_at: nextTimestamp() });
  return { rows: returning ? matches.map((row) => pick(row, returning)) : [], rowCount: matches.length };
}

function remove([where], params) {
  const matches = rowMatcher(where, params);
  const before = state.rows.length;
  state.rows = state.rows.filter((row) => !matches(row));
  return { rows: [], rowCount: before - state.rows.length };
}

const STATEMENTS = [
  [/^(BEGIN|COMMIT|ROLLBACK)$/i, transactionControl],
  [/^SELECT (.+?) FROM public\.transactions WHERE (.+?)(?: ORDER BY (.+?))?(?: LIMIT \$(\d+))?$/i, select],
  [/^INSERT INTO public\.transactions \((.+?)\) VALUES (.+?)(?: RETURNING (.+))?$/i, insert],
  [/^UPDATE public\.transactions SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/i, update],
  [/^DELETE FROM public\.transactions WHERE (.+)$/i, remove],
];

async function runQuery(text, params = []) {
  const sql = text.replace(/\s+/g, ' ').trim();
  state.queries.push({ sql, params: [...params] });

  const failure = state.failures.findIndex(({ pattern }) => pattern.test(sql));
  if (failure !== -1) {
    const [{ error }] = state.failures.splice(failure, 1);
    throw error;
  }

  for (const [pattern, handler] of STATEMENTS) {
    const match = pattern.exec(sql);
    if (match) return handler(match.slice(1), params);
  }
  throw new Error(`Fake database: unsupported statement: ${sql}`);
}

export const pingDatabase = vi.fn();

export const pool = {
  query: runQuery,
  async connect() {
    state.openClients += 1;
    let released = false;
    return {
      query: runQuery,
      release() {
        if (!released) state.openClients -= 1;
        released = true;
      },
    };
  },
  async end() {},
  on() {},
};

// The module that replaces src/db.js. Same exports, same shapes.
export const fakeDbModule = { pool, query: runQuery, pingDatabase };
