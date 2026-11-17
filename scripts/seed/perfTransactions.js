// The 1,000 transactions npm run seed:perf gives one demo user (US-62): a year of
// realistic money in and out, across every category, to time the app with. Pure
// functions with no database access, so they can be tested on their own.
//
// The set is the same on every run for the same day (a seeded random number generator,
// not Math.random), so timings can be compared from one run to the next.

export const PERF_TRANSACTION_COUNT = 1000;
export const PERF_HISTORY_MONTHS = 12;

// Perf rows are marked by their created_at, which the app never shows: one millisecond
// apart, starting here. Re-running the script deletes exactly the rows in this window
// before inserting the new set, so nothing is ever duplicated, and nothing else the demo
// user has is touched. (Real rows are created "now", decades after the window.)
export const PERF_CREATED_AT_START = '2001-01-01T00:00:00.000Z';
export const PERF_CREATED_AT_END = '2001-01-02T00:00:00.000Z';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// What a year of transactions looks like, per month: [type, category, descriptions,
// smallest and largest amount in cents, how many a month].
const MONTHLY_PATTERN = Object.freeze([
  ['income', null, ['Salary'], [310000, 330000], 2],
  ['income', null, ['Freelance design work', 'Tax refund', 'Sold old bike', 'Birthday gift'], [4000, 60000], 1],
  ['expense', 'Housing', ['Rent'], [175000, 175000], 1],
  ['expense', 'Housing', ['Hydro bill', 'Internet', 'Tenant insurance', 'Water heater rental'], [2150, 11500], 3],
  ['expense', 'Food', ['Groceries at No Frills', 'Groceries at Metro', 'Farmers market', 'Costco run'], [2500, 18500], 14],
  ['expense', 'Food', ['Coffee and bagel', 'Lunch with coworkers', 'Pizza night', 'Sushi takeout', 'Bakery'], [450, 6800], 18],
  ['expense', 'Transportation', ['Gas', 'PRESTO top-up', 'Parking', 'Rideshare home', 'Oil change'], [300, 9500], 12],
  ['expense', 'Entertainment', ['Movie tickets', 'Concert tickets', 'Streaming subscription', 'Bowling', 'Video game'], [649, 14500], 8],
  ['expense', 'Other', ['Phone bill', 'Haircut', 'Pharmacy', 'Gift for a friend', 'Gym membership', 'Charity donation'], [1500, 9000], 24],
]);

/** A small, fast, seeded random number generator (mulberry32): the same seed, the same numbers. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDay(text) {
  const match = typeof text === 'string' ? DATE_PATTERN.exec(text) : null;
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const time = match ? Date.UTC(year, month - 1, day) : NaN;
  const parsed = new Date(time);
  if (!match || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new TypeError(`today must be a real date as YYYY-MM-DD, got ${JSON.stringify(text)}.`);
  }
  return time;
}

/**
 * The perf set for a demo user: exactly PERF_TRANSACTION_COUNT transactions dated in the
 * PERF_HISTORY_MONTHS before (and including) `today`, newest first, each in the shape of a
 * POST /api/transactions body plus the created_at that marks it as a perf row.
 *
 * @param {string} today YYYY-MM-DD.
 * @param {number} [seed] Change it for a different (but still repeatable) set.
 * @returns {{ amount_cents: number, date: string, type: string, category: string|null, description: string, created_at: string }[]}
 */
export function generatePerfTransactions(today, seed = 62) {
  const end = parseDay(today);
  const random = seededRandom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));

  // The window: the same day 12 months ago (exclusive) up to today.
  const endDate = new Date(end);
  const start = Date.UTC(endDate.getUTCFullYear() - 1, endDate.getUTCMonth(), endDate.getUTCDate()) + DAY_MS;
  const days = Math.round((end - start) / DAY_MS) + 1;
  const dateAt = (offset) => new Date(start + offset * DAY_MS).toISOString().slice(0, 10);

  // The monthly pattern gives the mix; it's repeated across the year, then cut or topped
  // up to exactly the target count with more everyday expenses.
  const rows = [];
  for (let month = 0; month < PERF_HISTORY_MONTHS; month += 1) {
    for (const [type, category, descriptions, [low, high], perMonth] of MONTHLY_PATTERN) {
      for (let i = 0; i < perMonth; i += 1) {
        const dayInMonth = type === 'expense' && category === 'Housing' && descriptions[0] === 'Rent' ? 0 : between(0, 29);
        const offset = Math.min(days - 1, Math.floor((month * days) / PERF_HISTORY_MONTHS) + dayInMonth);
        rows.push({ amount_cents: between(low, high), date: dateAt(offset), type, category, description: pick(descriptions) });
      }
    }
  }
  const everyday = MONTHLY_PATTERN.filter(([type, , , , perMonth]) => type === 'expense' && perMonth >= 12);
  while (rows.length < PERF_TRANSACTION_COUNT) {
    const [type, category, descriptions, [low, high]] = pick(everyday);
    rows.push({ amount_cents: between(low, high), date: dateAt(between(0, days - 1)), type, category, description: pick(descriptions) });
  }
  rows.length = PERF_TRANSACTION_COUNT;

  rows.sort((a, b) => b.date.localeCompare(a.date));
  const createdStart = Date.parse(PERF_CREATED_AT_START);
  return rows.map((row, index) => ({ ...row, created_at: new Date(createdStart + index).toISOString() }));
}
