// npm run bench (US-62): times the API's endpoints the way the transactions page and the
// dashboard call them, against the API running on this machine, and prints p50 and p95
// per endpoint with PASS or FAIL against a budget. Read-only: every request is a GET.
//
// Needs BENCH_TOKEN, an access token for the demo user. Optional: BENCH_API_URL (default
// http://localhost:4000, must be localhost), BENCH_RUNS (default 30) and BENCH_MONTH
// (default this month). See "Performance check" in the README.

import { BenchError, WARMUP_RUNS, benchTargets, readBenchConfig, report } from './bench/bench.js';

async function timeOnce(apiUrl, token, paths) {
  const started = performance.now();
  await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      // Read the whole body, as the browser does, before stopping the clock.
      await response.arrayBuffer();
      if (response.status === 401) throw new BenchError('The API rejected BENCH_TOKEN (401). Get a fresh token: they last an hour.');
      if (!response.ok) throw new BenchError(`GET ${path} answered ${response.status}.`);
    })
  );
  return performance.now() - started;
}

async function main() {
  const { apiUrl, token, runs, month } = readBenchConfig(process.env);
  console.log(`Timing ${apiUrl} for ${month}: ${runs} runs per endpoint after ${WARMUP_RUNS} warm-up runs, one at a time.\n`);

  const results = [];
  for (const target of benchTargets(month)) {
    for (let i = 0; i < WARMUP_RUNS; i += 1) await timeOnce(apiUrl, token, target.paths);
    const timings = [];
    for (let i = 0; i < runs; i += 1) timings.push(await timeOnce(apiUrl, token, target.paths));
    results.push({ ...target, timings });
    process.stdout.write('.');
  }
  process.stdout.write('\n\n');

  const { lines, passed } = report(results);
  console.log(lines.join('\n'));
  if (!passed) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  const reachable = err?.cause?.code !== 'ECONNREFUSED';
  console.error(
    err instanceof BenchError
      ? `Bench failed: ${err.message}`
      : reachable
        ? `Bench failed: ${err?.message ?? err}`
        : 'Bench failed: the API is not running. Start it with npm run dev in another window.'
  );
  process.exitCode = 1;
}
