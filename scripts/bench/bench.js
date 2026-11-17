// The parts of npm run bench (US-62) that don't touch the network, so they can be tested:
// reading the settings, the list of requests to time, percentiles and the report.

export const DEFAULT_API_URL = 'http://localhost:4000';
export const DEFAULT_RUNS = 30;
export const WARMUP_RUNS = 3;

// What counts as passing. The browser loads the transactions page with one request and
// the dashboard with four in parallel; these leave at least a second of the 2-second
// budget for the browser to download, run and draw the page.
export const BUDGET_MS = Object.freeze({ request: 500, dashboard: 1000 });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class BenchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BenchError';
  }
}

const pad = (number) => String(number).padStart(2, '0');

/** YYYY-MM for a date, in local time. */
export function monthOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The YYYY-MM `count` months before `month`. */
export function monthsBefore(month, count) {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) - count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * Reads and checks the settings. The token is never printed.
 *
 * @param {Record<string, string|undefined>} env
 * @param {Date} now
 * @returns {{ apiUrl: string, token: string, runs: number, month: string }}
 * @throws {BenchError}
 */
export function readBenchConfig(env, now = new Date()) {
  const token = env.BENCH_TOKEN?.trim();
  if (!token) {
    throw new BenchError('Set BENCH_TOKEN to an access token for the demo user (see "Performance check" in the README).');
  }

  const apiUrl = (env.BENCH_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new BenchError(`BENCH_API_URL is not a valid URL: ${apiUrl}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new BenchError(`BENCH_API_URL must be the API running on this machine (localhost), not ${url.hostname}.`);
  }

  const runs = env.BENCH_RUNS === undefined || env.BENCH_RUNS === '' ? DEFAULT_RUNS : Number(env.BENCH_RUNS);
  if (!Number.isInteger(runs) || runs < 5 || runs > 500) {
    throw new BenchError('BENCH_RUNS must be a whole number from 5 to 500.');
  }

  const month = env.BENCH_MONTH?.trim() || monthOf(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BenchError('BENCH_MONTH must be YYYY-MM, e.g. 2026-11.');

  return { apiUrl, token, runs, month };
}

/**
 * What to time: each is one request, or (the dashboard) several sent at once, timed until
 * the last answers, as the browser does.
 *
 * @param {string} month YYYY-MM, the month the pages show.
 * @returns {{ name: string, paths: string[], budget: number }[]}
 */
export function benchTargets(month) {
  const threeMonthsAgo = `${monthsBefore(month, 3)}-01`;
  const one = (name, path) => ({ name, paths: [path], budget: BUDGET_MS.request });
  return [
    one('transactions: page 1 (the page as it opens)', '/api/transactions'),
    one('transactions: page 2', '/api/transactions?page=2'),
    one('transactions: page 25', '/api/transactions?page=25'),
    one('transactions: last pages (page 50)', '/api/transactions?page=50'),
    one('transactions: search "groceries"', '/api/transactions?q=groceries'),
    one('transactions: search "coffee", page 2', '/api/transactions?q=coffee&page=2'),
    one('transactions: category Food', '/api/transactions?category=Food'),
    one('transactions: Food and Transportation', '/api/transactions?category=Food&category=Transportation'),
    one('transactions: last 3 months', `/api/transactions?from=${threeMonthsAgo}`),
    one('transactions: search + category + dates', `/api/transactions?q=gro&category=Food&from=${threeMonthsAgo}`),
    one('summary', `/api/summary?month=${month}`),
    one('summary: by category', `/api/summary/categories?month=${month}`),
    one('summary: 6-month trend', `/api/summary/trend?month=${month}`),
    one('budgets', '/api/budgets'),
    one('budgets: status', `/api/budgets/status?month=${month}`),
    one('goals', '/api/goals'),
    {
      name: 'dashboard (4 requests at once)',
      paths: [
        `/api/summary?month=${month}`,
        `/api/budgets/status?month=${month}`,
        `/api/summary/categories?month=${month}`,
        `/api/summary/trend?month=${month}`,
      ],
      budget: BUDGET_MS.dashboard,
    },
  ];
}

/**
 * The value below which `percent` of the timings fall (nearest rank).
 *
 * @param {number[]} values
 * @param {number} percent 0 to 100.
 */
export function percentile(values, percent) {
  if (values.length === 0) throw new RangeError('No timings.');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percent / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/**
 * @param {{ name: string, budget: number, timings: number[] }[]} results
 * @returns {{ lines: string[], passed: boolean }}
 */
export function report(results) {
  const rows = results.map(({ name, budget, timings }) => {
    const p50 = percentile(timings, 50);
    const p95 = percentile(timings, 95);
    const max = Math.max(...timings);
    return { name, budget, p50, p95, max, ok: p95 <= budget };
  });
  const width = Math.max(...rows.map(({ name }) => name.length), 'Endpoint'.length);
  const ms = (value) => `${value.toFixed(0)} ms`.padStart(8);
  const lines = [
    `${'Endpoint'.padEnd(width)}      p50      p95      max   budget (p95)`,
    ...rows.map(({ name, budget, p50, p95, max, ok }) =>
      `${name.padEnd(width)} ${ms(p50)} ${ms(p95)} ${ms(max)} ${ms(budget)}  ${ok ? 'PASS' : 'FAIL'}`
    ),
  ];
  const passed = rows.every(({ ok }) => ok);
  lines.push('', passed ? 'PASS: every endpoint is within its budget.' : 'FAIL: the endpoints marked FAIL are over budget.');
  return { lines, passed };
}
