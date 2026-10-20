// In-memory stand-in for src/db.js, installed for every test by test/setup.js.
//
// It runs the simple SQL the app sends to the tables in TABLES below:
//
//   SELECT <select list> FROM public.<table> [WHERE ...] [GROUP BY ...] [ORDER BY ...]
//          [LIMIT $n] [OFFSET $n]
//   INSERT INTO public.<table> (...) VALUES (...), (...) [RETURNING ...]
//   UPDATE public.<table> SET col = $n, ... WHERE ... [RETURNING ...]
//   DELETE FROM public.<table> WHERE ...
//   BEGIN / COMMIT / ROLLBACK
//
// A select list holds plain columns, COUNT(*) and SUM(column), each aggregate with
// `AS name` and an optional `::int`. Like pg, an aggregate comes back as a BIGINT
// string unless it's cast to int. WHERE conditions are joined by AND: `column = $n`,
// `column = ANY($n)`, `column >= $n` (and <=, <, >) and `column ILIKE $n ESCAPE '\'`.
//
// It applies exactly the conditions written in the SQL, so a query that lost its
// user_id check would expose other users' rows here too and the ownership tests would
// fail. Unique constraints are enforced and fail with a pg-shaped 23505 error. Any
// other statement, condition or table throws, so new SQL fails loudly until it's
// supported here.

import { vi } from 'vitest';

const CLOCK_START = Date.UTC(2026, 0, 1);

// The tables the fake knows, with each column's starting value and the unique
// constraints from db/migrations (named as Postgres names them).
const TABLES = {
  transactions: {
    columns: { user_id: null, amount_cents: null, date: null, type: null, category: null, description: null },
    unique: [],
  },
  budgets: {
    columns: { user_id: null, category: null, limit_cents: null },
    unique: [{ name: 'budgets_user_id_category_key', columns: ['user_id', 'category'] }],
  },
};

const state = {};

function emptyTables() {
  return Object.fromEntries(Object.keys(TABLES).map((name) => [name, { rows: [], nextId: 1 }]));
}

function copyTables(tables) {
  return Object.fromEntries(
    Object.entries(tables).map(([name, { rows, nextId }]) => [name, { rows: rows.map((row) => ({ ...row })), nextId }])
  );
}

export function resetFakeDatabase() {
  Object.assign(state, {
    tables: emptyTables(),
    ticks: 0,
    snapshot: null,
    queries: [],
    failures: [],
    openClients: 0,
  });
  pingDatabase.mockReset();
  pingDatabase.mockResolvedValue(undefined);
}

function tableNamed(name) {
  if (!TABLES[name]) throw new Error(`Fake database: unknown table public.${name}`);
  return state.tables[name];
}

/** Each call is one second after the last, so rows have a clear creation order. */
function nextTimestamp() {
  state.ticks += 1;
  return new Date(CLOCK_START + state.ticks * 1000).toISOString();
}

function newRow(name, values) {
  const table = tableNamed(name);
  const timestamp = nextTimestamp();
  return {
    id: String(table.nextId++),
    ...TABLES[name].columns,
    created_at: timestamp,
    updated_at: timestamp,
    ...values,
  };
}

/** An error shaped like the one pg raises when a constraint is broken. */
function pgError(code, constraint, message) {
  return Object.assign(new Error(message), { code, constraint });
}

// Throws 23505 if any of `candidates` would share a unique key with another row. Like
// Postgres, a key with a NULL in it never clashes.
function checkUnique(name, candidates) {
  const { rows } = tableNamed(name);
  for (const { name: constraint, columns } of TABLES[name].unique) {
    const keyOf = (row) => (columns.some((column) => row[column] === null) ? null : JSON.stringify(columns.map((c) => row[c])));
    const seen = new Map(rows.filter((row) => !candidates.some((c) => c.id === row.id)).map((row) => [keyOf(row), row]));
    for (const candidate of candidates) {
      const key = keyOf(candidate);
      if (key === null) continue;
      if (seen.has(key)) {
        throw pgError('23505', constraint, `duplicate key value violates unique constraint "${constraint}"`);
      }
      seen.set(key, candidate);
    }
  }
}

/** Puts rows straight into a table, as if another request had created them. Returns copies. */
export function addRowsTo(name, ...rows) {
  const added = rows.map((values) => newRow(name, values));
  checkUnique(name, added);
  tableNamed(name).rows.push(...added);
  return added.map((row) => ({ ...row }));
}

/** A copy of every row currently in a table. */
export function storedRowsIn(name) {
  return tableNamed(name).rows.map((row) => ({ ...row }));
}

/** addRowsTo('transactions', ...rows). */
export function addRows(...rows) {
  return addRowsTo('transactions', ...rows);
}

/** storedRowsIn('transactions'). */
export function storedRows() {
  return storedRowsIn('transactions');
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

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A LIKE pattern as a case-insensitive RegExp: % is any text, _ is one character, and
// a backslash makes the next character literal (ESCAPE '\').
function likeToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) {
      i += 1;
      source += escapeRegExp(pattern[i]);
    } else if (char === '%') {
      source += '[\\s\\S]*';
    } else if (char === '_') {
      source += '[\\s\\S]';
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

// Ids are digit strings (BIGINT comes back from pg as a string), so compare them as numbers.
function compareValues(a, b) {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const difference = BigInt(a) - BigInt(b);
    return difference === 0n ? 0 : difference < 0n ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const COMPARISONS = {
  '>=': (result) => result >= 0,
  '<=': (result) => result <= 0,
  '>': (result) => result > 0,
  '<': (result) => result < 0,
};

// Each WHERE condition the fake understands: its pattern, and a function that takes
// the match and the parameters and returns a test for one row. Like Postgres, NULL
// never matches a comparison or a LIKE.
const CONDITIONS = [
  [
    /^(\w+) = ANY\(\$(\d+)(?:::\w+\[\])?\)$/i,
    ([, column, ref], params) => {
      const values = param(params, ref).map(String);
      return (row) => values.includes(String(row[column]));
    },
  ],
  [
    /^(\w+) = \$(\d+)$/,
    ([, column, ref], params) => {
      const value = String(param(params, ref));
      return (row) => String(row[column]) === value;
    },
  ],
  [
    /^(\w+) (>=|<=|>|<) \$(\d+)$/,
    ([, column, operator, ref], params) => {
      const value = param(params, ref);
      return (row) => row[column] !== null && COMPARISONS[operator](compareValues(row[column], value));
    },
  ],
  [
    /^(\w+) ILIKE \$(\d+) ESCAPE '\\'$/i,
    ([, column, ref], params) => {
      const pattern = likeToRegExp(param(params, ref));
      return (row) => row[column] !== null && pattern.test(row[column]);
    },
  ],
];

function rowMatcher(where, params) {
  if (!where) return () => true;
  const checks = where.split(/ AND /i).map((condition) => {
    for (const [pattern, build] of CONDITIONS) {
      const match = pattern.exec(condition);
      if (match) return build(match, params);
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

// One item of a select list, as a function from a group of rows to its value.
// Aggregates come back as BIGINT strings, as pg returns them, unless cast with ::int.
const SELECT_ITEMS = [
  [/^(\w+)$/, ([, column]) => ({ name: column, aggregate: false, value: (rows) => rows[0][column] })],
  [
    /^COUNT\(\*\)(::int)? AS (\w+)$/i,
    ([, cast, name]) => ({
      name,
      aggregate: true,
      value: (rows) => (cast ? rows.length : String(rows.length)),
    }),
  ],
  [
    /^SUM\((\w+)\)(::int)? AS (\w+)$/i,
    ([, column, cast, name]) => ({
      name,
      aggregate: true,
      value: (rows) => {
        const values = rows.map((row) => row[column]).filter((value) => value !== null);
        // SUM over no rows (or only NULLs) is NULL.
        if (values.length === 0) return null;
        const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
        return cast ? Number(total) : String(total);
      },
    }),
  ],
];

function parseSelectList(text) {
  return columnList(text).map((item) => {
    for (const [pattern, build] of SELECT_ITEMS) {
      const match = pattern.exec(item);
      if (match) return build(match);
    }
    throw new Error(`Fake database: unsupported select item "${item}"`);
  });
}

// Splits rows into GROUP BY groups, in first-seen order. Without GROUP BY, an
// aggregate query has one group, even when no rows match (COUNT(*) is then 0).
function groupRows(rows, groupBy) {
  if (!groupBy) return [rows];
  const columns = columnList(groupBy);
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify(columns.map((column) => row[column]));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

function select(name, [list, where, groupBy, orderBy, limitRef, offsetRef], params) {
  let rows = tableNamed(name).rows.filter(rowMatcher(where, params));
  const items = parseSelectList(list);

  if (groupBy || items.some((item) => item.aggregate)) {
    const grouped = groupBy ? columnList(groupBy) : [];
    const ungrouped = items.find((item) => !item.aggregate && !grouped.includes(item.name));
    if (ungrouped) throw new Error(`Fake database: column "${ungrouped.name}" must appear in GROUP BY`);
    rows = groupRows(rows, groupBy).map((group) =>
      Object.fromEntries(items.map((item) => [item.name, item.value(group)]))
    );
  } else {
    rows = rows.map((row) => Object.fromEntries(items.map((item) => [item.name, row[item.name]])));
  }

  if (orderBy) rows = [...rows].sort(rowComparator(orderBy));
  const offset = offsetRef ? param(params, offsetRef) : 0;
  const end = limitRef ? offset + param(params, limitRef) : undefined;
  rows = rows.slice(offset, end);
  return { rows, rowCount: rows.length };
}

function insert(name, [columns, values, returning], params) {
  const names = columnList(columns);
  const groups = [...values.matchAll(/\(([^)]*)\)/g)].map((match) => columnList(match[1]));
  const added = groups.map((refs) => {
    if (refs.length !== names.length) throw new Error('Fake database: INSERT column/value count mismatch');
    return newRow(name, Object.fromEntries(names.map((column, i) => [column, param(params, refs[i].slice(1))])));
  });
  checkUnique(name, added);
  tableNamed(name).rows.push(...added);
  return { rows: returning ? added.map((row) => pick(row, returning)) : [], rowCount: added.length };
}

function update(name, [assignments, where, returning], params) {
  const changes = Object.fromEntries(
    columnList(assignments).map((assignment) => {
      const match = /^(\w+) = \$(\d+)$/.exec(assignment);
      if (!match) throw new Error(`Fake database: unsupported assignment "${assignment}"`);
      return [match[1], param(params, match[2])];
    })
  );
  const matches = tableNamed(name).rows.filter(rowMatcher(where, params));
  // Check the changed rows first, so a clash changes nothing, as in Postgres.
  checkUnique(name, matches.map((row) => ({ ...row, ...changes })));
  // updated_at mirrors the <table>_set_updated_at triggers.
  for (const row of matches) Object.assign(row, changes, { updated_at: nextTimestamp() });
  return { rows: returning ? matches.map((row) => pick(row, returning)) : [], rowCount: matches.length };
}

function remove(name, [where], params) {
  const table = tableNamed(name);
  const matches = rowMatcher(where, params);
  const before = table.rows.length;
  table.rows = table.rows.filter((row) => !matches(row));
  return { rows: [], rowCount: before - table.rows.length };
}

function transactionControl(command) {
  const keyword = command.toUpperCase();
  if (keyword === 'BEGIN') {
    if (state.snapshot) throw new Error('Fake database: BEGIN inside an open transaction');
    state.snapshot = copyTables(state.tables);
  } else if (keyword === 'ROLLBACK') {
    if (state.snapshot) state.tables = state.snapshot;
    state.snapshot = null;
  } else {
    state.snapshot = null;
  }
  return { rows: [], rowCount: 0 };
}

// Each statement: its pattern (the first group is the table name) and its handler.
const STATEMENTS = [
  [
    /^SELECT (.+?) FROM public\.(\w+)(?: WHERE (.+?))?(?: GROUP BY (.+?))?(?: ORDER BY (.+?))?(?: LIMIT \$(\d+))?(?: OFFSET \$(\d+))?$/i,
    ([list, name, ...rest], params) => select(name, [list, ...rest], params),
  ],
  [/^INSERT INTO public\.(\w+) \((.+?)\) VALUES (.+?)(?: RETURNING (.+))?$/i, ([name, ...rest], params) => insert(name, rest, params)],
  [/^UPDATE public\.(\w+) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/i, ([name, ...rest], params) => update(name, rest, params)],
  [/^DELETE FROM public\.(\w+) WHERE (.+)$/i, ([name, ...rest], params) => remove(name, rest, params)],
];

async function runQuery(text, params = []) {
  const sql = text.replace(/\s+/g, ' ').trim();
  state.queries.push({ sql, params: [...params] });

  const failure = state.failures.findIndex(({ pattern }) => pattern.test(sql));
  if (failure !== -1) {
    const [{ error }] = state.failures.splice(failure, 1);
    throw error;
  }

  const control = /^(BEGIN|COMMIT|ROLLBACK)$/i.exec(sql);
  if (control) return transactionControl(control[1]);

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
