// Sample transactions for the seed script. Pure functions with no database or
// Supabase access, so they can be tested on their own.

// Every sample row is dated within this many days before today (about three months).
export const SAMPLE_HISTORY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// One list per sample user. Each row is
// [days before today, type, category, description, amount in cents].
export const SAMPLE_PROFILES = Object.freeze([
  // A student with a part-time job.
  Object.freeze([
    [4, 'income', null, 'Part-time job paycheque', 68540],
    [18, 'income', null, 'Part-time job paycheque', 71225],
    [34, 'income', null, 'Part-time job paycheque', 66890],
    [48, 'income', null, 'Part-time job paycheque', 70310],
    [64, 'income', null, 'Part-time job paycheque', 69475],
    [78, 'income', null, 'Part-time job paycheque', 67150],
    [2, 'expense', 'Housing', 'Rent share', 85000],
    [32, 'expense', 'Housing', 'Rent share', 85000],
    [62, 'expense', 'Housing', 'Rent share', 85000],
    [40, 'expense', 'Housing', 'Tenant insurance', 2150],
    [1, 'expense', 'Food', 'Groceries at No Frills', 6423],
    [9, 'expense', 'Food', 'Campus cafeteria lunch', 1375],
    [16, 'expense', 'Food', 'Groceries at No Frills', 5890],
    [30, 'expense', 'Food', 'Pizza night with roommates', 2240],
    [44, 'expense', 'Food', 'Groceries at Metro', 7215],
    [58, 'expense', 'Food', 'Coffee and bagel', 785],
    [73, 'expense', 'Food', 'Groceries at No Frills', 6104],
    [3, 'expense', 'Transportation', 'PRESTO monthly pass', 12815],
    [33, 'expense', 'Transportation', 'PRESTO monthly pass', 12815],
    [63, 'expense', 'Transportation', 'PRESTO monthly pass', 12815],
    [25, 'expense', 'Transportation', 'Rideshare home after a late shift', 1867],
    [7, 'expense', 'Entertainment', 'Music streaming subscription', 649],
    [37, 'expense', 'Entertainment', 'Music streaming subscription', 649],
    [52, 'expense', 'Entertainment', 'Movie tickets', 1598],
    [67, 'expense', 'Entertainment', 'Music streaming subscription', 649],
    [12, 'expense', 'Other', 'Phone bill', 4500],
    [42, 'expense', 'Other', 'Phone bill', 4500],
    [86, 'expense', 'Other', 'Used textbook', 8999],
  ]),
  // An early-career professional.
  Object.freeze([
    [1, 'income', null, 'Salary deposit', 245000],
    [15, 'income', null, 'Salary deposit', 245000],
    [31, 'income', null, 'Salary deposit', 245000],
    [45, 'income', null, 'Salary deposit', 245000],
    [61, 'income', null, 'Salary deposit', 245000],
    [75, 'income', null, 'Salary deposit', 245000],
    [22, 'income', null, 'Sold old bike online', 15000],
    [2, 'expense', 'Housing', 'Rent', 182500],
    [32, 'expense', 'Housing', 'Rent', 182500],
    [62, 'expense', 'Housing', 'Rent', 182500],
    [20, 'expense', 'Housing', 'Hydro bill', 7342],
    [50, 'expense', 'Housing', 'Hydro bill', 6918],
    [3, 'expense', 'Food', 'Groceries at Loblaws', 11236],
    [10, 'expense', 'Food', 'Sushi dinner', 4870],
    [24, 'expense', 'Food', 'Groceries at Loblaws', 9875],
    [38, 'expense', 'Food', 'Work lunch', 1650],
    [55, 'expense', 'Food', 'Groceries at Costco', 18420],
    [81, 'expense', 'Food', 'Brunch with friends', 3825],
    [6, 'expense', 'Transportation', 'Gas fill-up', 6150],
    [28, 'expense', 'Transportation', 'Gas fill-up', 5890],
    [57, 'expense', 'Transportation', 'Car insurance', 16500],
    [84, 'expense', 'Transportation', 'Oil change', 8999],
    [13, 'expense', 'Entertainment', 'Video streaming subscription', 2099],
    [43, 'expense', 'Entertainment', 'Video streaming subscription', 2099],
    [47, 'expense', 'Entertainment', 'Basketball game tickets', 12400],
    [17, 'expense', 'Other', 'Gym membership', 5499],
    [47, 'expense', 'Other', 'Gym membership', 5499],
    [70, 'expense', 'Other', 'Birthday gift', 4500],
  ]),
]);

/**
 * A date as YYYY-MM-DD in the local time zone. toISOString() would use UTC, which is
 * already tomorrow on an evening in Toronto.
 *
 * @param {Date} date
 */
export function localDateString(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The date `days` days before `today`, both YYYY-MM-DD. Worked out in UTC, so it never
// skips or repeats a day around daylight saving changes.
function daysBefore(today, days) {
  const [year, month, day] = DATE_PATTERN.exec(today).slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) - days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function assertDate(today) {
  const match = typeof today === 'string' ? DATE_PATTERN.exec(today) : null;
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const parsed = match ? new Date(Date.UTC(year, month - 1, day)) : null;
  if (!parsed || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new TypeError(`today must be a real date as YYYY-MM-DD, got ${JSON.stringify(today)}.`);
  }
}

/**
 * The sample transactions for one sample user, newest first, in the same shape as a
 * POST /api/transactions body.
 *
 * @param {number} profileIndex Which sample user: 0 or 1.
 * @param {string} today YYYY-MM-DD; every row is dated in the SAMPLE_HISTORY_DAYS before it.
 * @returns {{ amount_cents: number, date: string, type: string, category: string|null, description: string }[]}
 */
export function generateSampleTransactions(profileIndex, today) {
  const profile = SAMPLE_PROFILES[profileIndex];
  if (!profile) {
    throw new RangeError(`profileIndex must be between 0 and ${SAMPLE_PROFILES.length - 1}, got ${profileIndex}.`);
  }
  assertDate(today);

  return [...profile]
    .sort(([a], [b]) => a - b)
    .map(([daysAgo, type, category, description, amount_cents]) => ({
      amount_cents,
      date: daysBefore(today, daysAgo),
      type,
      category,
      description,
    }));
}
