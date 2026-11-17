// US-53, US-54: every endpoint that takes a body or a query string, sent invalid input
// through the real app. Each case must return 400 with exactly the expected
// { errors: { field: message } }, every invalid field at once, and never reach the
// database. Valid edge cases (1 cent, the maximum, a leap day, the ends of the date
// range) must be accepted.
//
// The rules and messages themselves are unit tested in rules.test.js; this file checks
// that every route applies them.

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MAX_AMOUNT_CENTS } from '../../src/constants.js';
import { MAX_DATE, MESSAGES, MIN_DATE } from '../../src/validation/rules.js';
import { ALICE, bearer } from '../support/fakeAuth.js';
import { addRows, addRowsTo, recordedQueries } from '../support/fakeDatabase.js';

const app = createApp();

// Marks a field to leave out of the body.
const MISSING = Symbol('missing');

const CATEGORY_CHOICES = 'Category must be one of Food, Transportation, Housing, Entertainment or Other.';
const MONTH_FORMAT = 'Month must be a real month in YYYY-MM format, for example 2026-10.';

const TRANSACTION = { amount_cents: 1250, date: '2026-10-05', type: 'expense', category: 'Food', description: 'Lunch' };
const BUDGET = { category: 'Food', limit_cents: 50000 };
const GOAL = { name: 'Trip to Japan', target_cents: 350000, target_date: '2027-04-01' };
const CONTRIBUTION = { amount_cents: 2500 };

function withField(body, field, value) {
  const copy = { ...body };
  if (value === MISSING) delete copy[field];
  else copy[field] = value;
  return copy;
}

function sendJson(method, path, body) {
  return request(app)[method](path).set('Authorization', bearer(ALICE)).send(body);
}

function sendRaw(method, path, text, type = 'application/json') {
  return request(app)[method](path).set('Authorization', bearer(ALICE)).set('Content-Type', type).send(text);
}

async function expectRejected(response, errors) {
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ errors });
  expect(recordedQueries()).toEqual([]);
}

// ALICE owns transaction 1, budget 1 and goal 1, so the valid PUT and contribution
// cases have something to change.
beforeEach(() => {
  addRows({ user_id: ALICE.id, ...TRANSACTION });
  addRowsTo('budgets', { user_id: ALICE.id, category: 'Food', limit_cents: 100 });
  addRowsTo('goals', { user_id: ALICE.id, ...GOAL });
});

// Every endpoint with a JSON body: a valid body, its money field and label, its date
// fields, and the status a valid body gets.
const BODY_ENDPOINTS = [
  { route: 'POST /api/transactions', method: 'post', path: '/api/transactions', valid: TRANSACTION, money: ['amount_cents', 'Amount'], dates: [['date', 'Date', true]], ok: 201 },
  { route: 'PUT /api/transactions/:id', method: 'put', path: '/api/transactions/1', valid: TRANSACTION, money: ['amount_cents', 'Amount'], dates: [['date', 'Date', true]], ok: 200 },
  { route: 'POST /api/budgets', method: 'post', path: '/api/budgets', valid: { ...BUDGET, category: 'Housing' }, money: ['limit_cents', 'Limit'], dates: [], ok: 201 },
  { route: 'PUT /api/budgets/:id', method: 'put', path: '/api/budgets/1', valid: { limit_cents: 50000 }, money: ['limit_cents', 'Limit'], dates: [], ok: 200 },
  { route: 'POST /api/goals', method: 'post', path: '/api/goals', valid: GOAL, money: ['target_cents', 'Target'], dates: [['target_date', 'Target date', false]], ok: 201 },
  { route: 'PUT /api/goals/:id', method: 'put', path: '/api/goals/1', valid: GOAL, money: ['target_cents', 'Target'], dates: [['target_date', 'Target date', false]], ok: 200 },
  { route: 'POST /api/goals/:id/contributions', method: 'post', path: '/api/goals/1/contributions', valid: CONTRIBUTION, money: ['amount_cents', 'Amount'], dates: [], ok: 200 },
];

const MONEY_CASES = [
  ['missing', MISSING, MESSAGES.required],
  ['null', null, MESSAGES.required],
  ['an empty string', '', MESSAGES.required],
  ['zero', 0, MESSAGES.positive],
  ['negative', -1, MESSAGES.positive],
  ['a large negative', -250000, MESSAGES.positive],
  ['a fraction of a cent', 0.5, MESSAGES.wholeCents],
  ['too many decimals', 12.345, MESSAGES.wholeCents],
  ['non-numeric text', 'twelve', MESSAGES.wholeCents],
  ['digits then letters', '12abc', MESSAGES.wholeCents],
  ['a numeric string', '1250', MESSAGES.wholeCents],
  ['an exponent string', '1e3', MESSAGES.wholeCents],
  ['the text "Infinity"', 'Infinity', MESSAGES.wholeCents],
  ['the text "NaN"', 'NaN', MESSAGES.wholeCents],
  ['a boolean', true, MESSAGES.wholeCents],
  ['an array', [1250], MESSAGES.wholeCents],
  ['an object', { cents: 1250 }, MESSAGES.wholeCents],
  ['one cent over the maximum', MAX_AMOUNT_CENTS + 1, MESSAGES.maxAmount],
  ['huge', 1e21, MESSAGES.maxAmount],
];

const DATE_CASES = [
  ['slashes', '2026/10/05', MESSAGES.dateFormat],
  ['day first', '05-10-2026', MESSAGES.dateFormat],
  ['single digits', '2026-1-5', MESSAGES.dateFormat],
  ['a time', '2026-10-05T12:00:00Z', MESSAGES.dateFormat],
  ['a leading space', ' 2026-10-05', MESSAGES.dateFormat],
  ['words', 'next week', MESSAGES.dateFormat],
  ['a number', 20261005, MESSAGES.dateFormat],
  ['Feb 29 in a non-leap year', '2025-02-29', MESSAGES.realDate],
  ['Feb 30', '2026-02-30', MESSAGES.realDate],
  ['April 31', '2026-04-31', MESSAGES.realDate],
  ['month 13', '2026-13-01', MESSAGES.realDate],
  ['before 1900', '1899-12-31', MESSAGES.dateRange],
  ['after 2100', '2101-01-01', MESSAGES.dateRange],
];

const MISSING_DATE_CASES = [
  ['missing', MISSING],
  ['null', null],
  ['an empty string', ''],
];

describe.each(BODY_ENDPOINTS)('$route', ({ method, path, valid, money: [moneyField, moneyLabel], dates, ok }) => {
  it.each(MONEY_CASES)(`rejects ${moneyField} that is %s`, async (_, value, message) => {
    const response = await sendJson(method, path, withField(valid, moneyField, value));

    await expectRejected(response, { [moneyField]: message(moneyLabel) });
  });

  it('rejects an amount too big for JSON numbers (1e400 arrives as Infinity)', async () => {
    const text = JSON.stringify({ ...valid, [moneyField]: 0 }).replace(`"${moneyField}":0`, `"${moneyField}":1e400`);

    const response = await sendRaw(method, path, text);

    await expectRejected(response, { [moneyField]: MESSAGES.wholeCents(moneyLabel) });
  });

  it.each([
    ['1 cent', 1],
    ['the maximum', MAX_AMOUNT_CENTS],
  ])(`accepts ${moneyField} of %s`, async (_, value) => {
    const response = await sendJson(method, path, withField(valid, moneyField, value));

    expect(response.status).toBe(ok);
  });

  describe.each(dates)('%s', (dateField, dateLabel, required) => {
    it.each(DATE_CASES)('rejects %s', async (_, value, message) => {
      const response = await sendJson(method, path, withField(valid, dateField, value));

      await expectRejected(response, { [dateField]: message(dateLabel) });
    });

    it.each(MISSING_DATE_CASES)(required ? 'rejects %s' : 'accepts %s, as no date', async (_, value) => {
      const response = await sendJson(method, path, withField(valid, dateField, value));

      if (required) await expectRejected(response, { [dateField]: MESSAGES.required(dateLabel) });
      else expect(response.status).toBe(ok);
    });

    it.each([
      ['a leap day', '2024-02-29'],
      ['the first allowed day', MIN_DATE],
      ['the last allowed day', MAX_DATE],
    ])('accepts %s', async (_, value) => {
      const response = await sendJson(method, path, withField(valid, dateField, value));

      expect(response.status).toBe(ok);
    });
  });

  it.each([
    ['cut off part-way', `{"${moneyField}": 12,`],
    ['unquoted keys', `{${moneyField}: 12}`],
    ['single quotes', `{'${moneyField}': 12}`],
    ['a bare NaN', 'NaN'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['a trailing comma', `{"${moneyField}": 12,}`],
  ])('returns 400, never 500, for malformed JSON: %s', async (_, text) => {
    const response = await sendRaw(method, path, text);

    await expectRejected(response, { body: MESSAGES.malformedJson });
  });

  it.each([
    ['a JSON array', () => sendRaw(method, path, '[]')],
    ['a body that is not JSON at all', () => sendRaw(method, path, 'amount=12', 'text/plain')],
    ['no body', () => request(app)[method](path).set('Authorization', bearer(ALICE))],
  ])('returns 400 for %s', async (_, send) => {
    const response = await send();

    expect(response.status).toBe(400);
    expect(response.body.errors.body).toBe(MESSAGES.bodyNotObject);
    expect(recordedQueries()).toEqual([]);
  });

  it('accepts the valid body', async () => {
    expect((await sendJson(method, path, valid)).status).toBe(ok);
  });
});

describe('transaction fields other than amount and date', () => {
  const CASES = [
    ['type missing', { type: MISSING, category: 'Food' }, { type: 'Type is required.' }],
    ['type in the wrong case', { type: 'Expense' }, { type: 'Type must be income or expense.' }],
    ['type unknown', { type: 'refund' }, { type: 'Type must be income or expense.' }],
    ['type a number', { type: 1 }, { type: 'Type must be income or expense.' }],
    ['category missing on an expense', { category: MISSING }, { category: 'Category is required for an expense.' }],
    ['category null on an expense', { category: null }, { category: 'Category is required for an expense.' }],
    ['category empty on an expense', { category: '' }, { category: 'Category is required for an expense.' }],
    ['category in the wrong case', { category: 'food' }, { category: CATEGORY_CHOICES }],
    ['category unknown', { category: 'Groceries' }, { category: CATEGORY_CHOICES }],
    ['category a number', { category: 7 }, { category: CATEGORY_CHOICES }],
    ['category unknown on an income', { type: 'income', category: 'Salary' }, { category: CATEGORY_CHOICES }],
    ['description a number', { description: 42 }, { description: 'Description must be text.' }],
    ['description an array', { description: ['Lunch'] }, { description: 'Description must be text.' }],
    ['description 256 characters', { description: 'a'.repeat(256) }, { description: 'Description must be 255 characters or fewer.' }],
  ];

  describe.each([
    ['POST /api/transactions', 'post', '/api/transactions'],
    ['PUT /api/transactions/:id', 'put', '/api/transactions/1'],
  ])('%s', (_, method, path) => {
    it.each(CASES)('rejects %s', async (__, changes, errors) => {
      let body = TRANSACTION;
      for (const [field, value] of Object.entries(changes)) body = withField(body, field, value);

      await expectRejected(await sendJson(method, path, body), errors);
    });

    it('returns every invalid field at once', async () => {
      const response = await sendJson(method, path, {
        amount_cents: -5,
        date: '2025-02-29',
        type: 'refund',
        category: 'Groceries',
        description: 5,
      });

      await expectRejected(response, {
        amount_cents: 'Amount must be greater than 0.',
        date: 'Date must be a real calendar date.',
        type: 'Type must be income or expense.',
        category: CATEGORY_CHOICES,
        description: 'Description must be text.',
      });
    });

    it.each([
      ['an income with no category', { type: 'income', category: MISSING }],
      ['a description of exactly 255 characters', { description: 'a'.repeat(255) }],
      ['255 emoji, counted as 255 characters', { description: '😀'.repeat(255) }],
      ['a description that is 255 characters after trimming', { description: `   ${'a'.repeat(255)}   ` }],
      ['no description', { description: MISSING }],
      ['a null description', { description: null }],
    ])('accepts %s', async (__, changes) => {
      let body = TRANSACTION;
      for (const [field, value] of Object.entries(changes)) body = withField(body, field, value);

      const response = await sendJson(method, path, body);

      expect(response.status).toBe(method === 'post' ? 201 : 200);
    });
  });

  it('saves the description trimmed, and a blank one as null', async () => {
    const trimmed = await sendJson('post', '/api/transactions', { ...TRANSACTION, description: '  Lunch  ' });
    const blank = await sendJson('post', '/api/transactions', { ...TRANSACTION, description: '   ' });

    expect(trimmed.body.transaction.description).toBe('Lunch');
    expect(blank.body.transaction.description).toBeNull();
  });
});

describe('POST /api/budgets category', () => {
  it.each([
    ['missing', MISSING, 'Category is required.'],
    ['null', null, 'Category is required.'],
    ['in the wrong case', 'food', CATEGORY_CHOICES],
    ['unknown', 'Groceries', CATEGORY_CHOICES],
    ['a number', 3, CATEGORY_CHOICES],
  ])('rejects a category that is %s', async (_, value, message) => {
    await expectRejected(await sendJson('post', '/api/budgets', withField(BUDGET, 'category', value)), { category: message });
  });

  it('returns every invalid field at once', async () => {
    await expectRejected(await sendJson('post', '/api/budgets', { category: 'Groceries', limit_cents: '500' }), {
      category: CATEGORY_CHOICES,
      limit_cents: MESSAGES.wholeCents('Limit'),
    });
  });
});

describe.each([
  ['POST /api/goals', 'post', '/api/goals', 201],
  ['PUT /api/goals/:id', 'put', '/api/goals/1', 200],
])('%s name', (_, method, path, ok) => {
  it.each([
    ['missing', MISSING, 'Name is required.'],
    ['null', null, 'Name is required.'],
    ['empty', '', 'Name is required.'],
    ['only spaces', '    ', 'Name is required.'],
    ['a number', 42, 'Name must be text.'],
    ['61 characters', 'a'.repeat(61), 'Name must be 60 characters or fewer.'],
  ])('rejects a name that is %s', async (__, value, message) => {
    await expectRejected(await sendJson(method, path, withField(GOAL, 'name', value)), { name: message });
  });

  it.each([
    ['60 characters', 'a'.repeat(60)],
    ['60 emoji', '😀'.repeat(60)],
  ])('accepts a name of %s', async (__, value) => {
    expect((await sendJson(method, path, withField(GOAL, 'name', value))).status).toBe(ok);
  });

  it('returns every invalid field at once', async () => {
    await expectRejected(await sendJson(method, path, { name: ' ', target_cents: 0, target_date: '2026-02-30' }), {
      name: 'Name is required.',
      target_cents: 'Target must be greater than 0.',
      target_date: 'Target date must be a real calendar date.',
    });
  });
});

describe('invalid ids', () => {
  const ID_ROUTES = [
    ['PUT /api/transactions/:id', 'put', (id) => `/api/transactions/${id}`, TRANSACTION],
    ['DELETE /api/transactions/:id', 'delete', (id) => `/api/transactions/${id}`],
    ['PUT /api/budgets/:id', 'put', (id) => `/api/budgets/${id}`, { limit_cents: 100 }],
    ['DELETE /api/budgets/:id', 'delete', (id) => `/api/budgets/${id}`],
    ['PUT /api/goals/:id', 'put', (id) => `/api/goals/${id}`, GOAL],
    ['DELETE /api/goals/:id', 'delete', (id) => `/api/goals/${id}`],
    ['POST /api/goals/:id/contributions', 'post', (id) => `/api/goals/${id}/contributions`, CONTRIBUTION],
  ];

  describe.each(ID_ROUTES)('%s', (_, method, pathFor, body) => {
    it.each(['abc', '0', '-1', '1.5', '01', '1e3', '9223372036854775808'])('returns 400 for the id %s', async (id) => {
      await expectRejected(await sendJson(method, pathFor(id), body), { id: MESSAGES.id });
    });
  });

  it.each([
    ['PUT /api/transactions/:id', 'put', '/api/transactions/abc', { ...TRANSACTION, amount_cents: 0 }, { amount_cents: 'Amount must be greater than 0.' }],
    ['PUT /api/budgets/:id', 'put', '/api/budgets/abc', { limit_cents: 0 }, { limit_cents: 'Limit must be greater than 0.' }],
    ['PUT /api/goals/:id', 'put', '/api/goals/abc', { ...GOAL, target_cents: 0 }, { target_cents: 'Target must be greater than 0.' }],
    ['POST /api/goals/:id/contributions', 'post', '/api/goals/abc/contributions', { amount_cents: 0 }, { amount_cents: 'Amount must be greater than 0.' }],
  ])('%s reports a bad id together with the invalid body', async (_, method, path, body, bodyErrors) => {
    await expectRejected(await sendJson(method, path, body), { id: MESSAGES.id, ...bodyErrors });
  });
});

describe('GET /api/transactions query', () => {
  const list = (query) => request(app).get(`/api/transactions?${query}`).set('Authorization', bearer(ALICE));
  const PAGE = 'Page must be a whole number from 1 to 100,000.';

  it.each([
    ['page 0', 'page=0', { page: PAGE }],
    ['a negative page', 'page=-1', { page: PAGE }],
    ['a decimal page', 'page=1.5', { page: PAGE }],
    ['a non-numeric page', 'page=abc', { page: PAGE }],
    ['an exponent page', 'page=1e3', { page: PAGE }],
    ['a page with a leading zero', 'page=01', { page: PAGE }],
    ['a page past the maximum', 'page=100001', { page: PAGE }],
    ['page given twice', 'page=1&page=2', { page: 'Page must be given only once.' }],
    ['search given twice', 'q=a&q=b', { q: 'Search must be given only once.' }],
    ['search of 256 characters', `q=${'a'.repeat(256)}`, { q: 'Search must be 255 characters or fewer.' }],
    ['an unknown category', 'category=Groceries', { category: CATEGORY_CHOICES }],
    ['one unknown category among valid ones', 'category=Food&category=food', { category: CATEGORY_CHOICES }],
    ['from in the wrong format', 'from=2026/10/01', { from: MESSAGES.dateFormat('From date') }],
    ['from an impossible date', 'from=2026-02-30', { from: MESSAGES.realDate('From date') }],
    ['to on Feb 29 in a non-leap year', 'to=2025-02-29', { to: MESSAGES.realDate('To date') }],
    ['to after 2100', 'to=2101-01-01', { to: MESSAGES.dateRange('To date') }],
    ['from given twice', 'from=2026-01-01&from=2026-02-01', { from: 'From date must be given only once.' }],
    ['from after to', 'from=2026-10-31&to=2026-10-01', { to: 'To date must be on or after the From date.' }],
    [
      'every parameter at once',
      'page=0&q=a&q=b&category=x&from=2026-13-01&to=nope',
      {
        page: PAGE,
        q: 'Search must be given only once.',
        category: CATEGORY_CHOICES,
        from: MESSAGES.realDate('From date'),
        to: MESSAGES.dateFormat('To date'),
      },
    ],
  ])('rejects %s', async (_, query, errors) => {
    await expectRejected(await list(query), errors);
  });

  it.each([
    ['an empty page, as page 1', 'page='],
    ['the last allowed page', 'page=100000'],
    ['from equal to to', 'from=2026-10-05&to=2026-10-05'],
    ['a leap day range', 'from=2024-02-29&to=2024-02-29'],
    ['the whole allowed range', `from=${MIN_DATE}&to=${MAX_DATE}`],
    ['a search of 255 characters', `q=${'a'.repeat(255)}`],
    ['several valid categories', 'category=Food&category=Housing'],
    ['an empty category, as no filter', 'category='],
  ])('accepts %s', async (_, query) => {
    expect((await list(query)).status).toBe(200);
  });
});

describe.each(['/api/summary', '/api/summary/categories', '/api/summary/trend', '/api/budgets/status'])('GET %s month', (path) => {
  const get = (query) => request(app).get(`${path}${query}`).set('Authorization', bearer(ALICE));

  it.each([
    ['missing', '', 'Month is required, in YYYY-MM format, for example 2026-10.'],
    ['empty', '?month=', 'Month is required, in YYYY-MM format, for example 2026-10.'],
    ['month 13', '?month=2026-13', MONTH_FORMAT],
    ['month 00', '?month=2026-00', MONTH_FORMAT],
    ['a single-digit month', '?month=2026-1', MONTH_FORMAT],
    ['a full date', '?month=2026-10-01', MONTH_FORMAT],
    ['a two-digit year', '?month=26-10', MONTH_FORMAT],
    ['words', '?month=october', MONTH_FORMAT],
    ['before 1900', '?month=1899-12', 'Month must be between 1900-01 and 2100-12.'],
    ['after 2100', '?month=2101-01', 'Month must be between 1900-01 and 2100-12.'],
    ['given twice', '?month=2026-10&month=2026-11', 'Month must be given only once.'],
  ])('rejects a month that is %s', async (_, query, message) => {
    await expectRejected(await get(query), { month: message });
  });

  it.each(['1900-01', '2100-12', '2024-02'])('accepts %s', async (month) => {
    expect((await get(`?month=${month}`)).status).toBe(200);
  });
});

describe('GET /api/summary/trend months', () => {
  const get = (query) => request(app).get(`/api/summary/trend?${query}`).set('Authorization', bearer(ALICE));
  const MONTHS = 'Months must be a whole number from 1 to 24.';

  it.each([
    ['0', 'months=0', { months: MONTHS }],
    ['25', 'months=25', { months: MONTHS }],
    ['negative', 'months=-1', { months: MONTHS }],
    ['a decimal', 'months=1.5', { months: MONTHS }],
    ['non-numeric', 'months=six', { months: MONTHS }],
    ['given twice', 'months=3&months=6', { months: 'Months must be given only once.' }],
  ])('rejects months that is %s', async (_, query, errors) => {
    await expectRejected(await get(`month=2026-10&${query}`), errors);
  });

  it('reports a bad month and bad months at once', async () => {
    await expectRejected(await get('month=2026-13&months=0'), { month: MONTH_FORMAT, months: MONTHS });
  });

  it.each(['months=1', 'months=24', 'months='])('accepts %s', async (query) => {
    expect((await get(`month=2026-10&${query}`)).status).toBe(200);
  });
});
