// US-62: the parts of npm run bench that don't need a running API.

import { describe, expect, it } from 'vitest';
import {
  BUDGET_MS,
  BenchError,
  DEFAULT_RUNS,
  benchTargets,
  monthsBefore,
  percentile,
  readBenchConfig,
  report,
} from '../scripts/bench/bench.js';

const NOW = new Date(2026, 10, 16, 12);

describe('readBenchConfig', () => {
  it('needs only a token, and defaults to the local API, 30 runs and this month', () => {
    expect(readBenchConfig({ BENCH_TOKEN: ' abc.def.ghi ' }, NOW)).toEqual({
      apiUrl: 'http://localhost:4000',
      token: 'abc.def.ghi',
      runs: DEFAULT_RUNS,
      month: '2026-11',
    });
  });

  it('takes the URL, runs and month from the environment', () => {
    const env = { BENCH_TOKEN: 't', BENCH_API_URL: 'http://127.0.0.1:4100/', BENCH_RUNS: '50', BENCH_MONTH: '2026-09' };
    expect(readBenchConfig(env, NOW)).toEqual({ apiUrl: 'http://127.0.0.1:4100', token: 't', runs: 50, month: '2026-09' });
  });

  it.each([
    ['no token', {}, /BENCH_TOKEN/],
    ['the deployed API', { BENCH_TOKEN: 't', BENCH_API_URL: 'https://finora-api-05iz.onrender.com' }, /localhost/],
    ['a URL that is not one', { BENCH_TOKEN: 't', BENCH_API_URL: 'localhost:4000' }, /localhost|valid URL/],
    ['too few runs', { BENCH_TOKEN: 't', BENCH_RUNS: '2' }, /BENCH_RUNS/],
    ['runs that are not a number', { BENCH_TOKEN: 't', BENCH_RUNS: 'lots' }, /BENCH_RUNS/],
    ['a month that is not one', { BENCH_TOKEN: 't', BENCH_MONTH: '2026-13' }, /BENCH_MONTH/],
  ])('refuses %s', (_, env, message) => {
    expect(() => readBenchConfig(env, NOW)).toThrow(BenchError);
    expect(() => readBenchConfig(env, NOW)).toThrow(message);
  });

  it('never puts the token in a message', () => {
    try {
      readBenchConfig({ BENCH_TOKEN: 'secret-token', BENCH_RUNS: '1' }, NOW);
    } catch (err) {
      expect(err.message).not.toContain('secret-token');
    }
  });
});

describe('benchTargets', () => {
  const targets = benchTargets('2026-11');

  it('times the list on several pages, with search, category and date filters', () => {
    const paths = targets.flatMap((target) => target.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/transactions',
        '/api/transactions?page=2',
        '/api/transactions?page=50',
        '/api/transactions?q=groceries',
        '/api/transactions?category=Food&category=Transportation',
        '/api/transactions?from=2026-08-01',
        '/api/transactions?q=gro&category=Food&from=2026-08-01',
      ])
    );
  });

  it('times the summary, budgets, goals and the dashboard’s four requests together', () => {
    const dashboard = targets.find((target) => target.name.startsWith('dashboard'));
    expect(dashboard.paths).toEqual([
      '/api/summary?month=2026-11',
      '/api/budgets/status?month=2026-11',
      '/api/summary/categories?month=2026-11',
      '/api/summary/trend?month=2026-11',
    ]);
    expect(dashboard.budget).toBe(BUDGET_MS.dashboard);
    for (const path of ['/api/summary?month=2026-11', '/api/budgets', '/api/goals']) {
      expect(targets.some((target) => target.paths.length === 1 && target.paths[0] === path)).toBe(true);
    }
  });

  it('only ever reads', () => {
    expect(targets.flatMap((target) => target.paths).every((path) => path.startsWith('/api/'))).toBe(true);
  });
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow(RangeError);
  });
});

describe('monthsBefore', () => {
  it('counts back across a new year', () => {
    expect(monthsBefore('2026-02', 3)).toBe('2025-11');
  });
});

describe('report', () => {
  it('passes when every p95 is within budget, and fails naming the slow ones', () => {
    const fast = { name: 'fast', budget: 500, timings: [100, 120, 130] };
    const slow = { name: 'slow', budget: 500, timings: [100, 900, 950] };

    expect(report([fast]).passed).toBe(true);
    const { lines, passed } = report([fast, slow]);
    expect(passed).toBe(false);
    expect(lines.find((line) => line.startsWith('slow'))).toMatch(/950 ms .*FAIL$/);
    expect(lines.at(-1)).toMatch(/^FAIL/);
  });
});
