// /api/summary: the logged-in user's totals for one month (US-27). Requires a token,
// and only ever counts that user's transactions.

import { Router } from 'express';
import { expenseTotalsByCategory } from '../budgets/repository.js';
import { expenseTotalsByDay, totalsByType } from '../summary/repository.js';
import { expensesByMonth } from '../summary/trend.js';
import { validateSummaryQuery, validateTrendQuery } from '../summary/validation.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { spendingByCategory } from '../summary/categories.js';
import { summarizeTotals } from '../summary/totals.js';

// GET /api/summary?month=YYYY-MM
export async function handleGetSummary(req, res) {
  const { errors, value } = validateSummaryQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const rows = await totalsByType(req.user.id, value);
  return res.json({ month: value.month, ...summarizeTotals(rows) });
}

// GET /api/summary/categories?month=YYYY-MM (US-43)
// Every expense category with what was spent in it that month, 0 included.
export async function handleGetCategorySpending(req, res) {
  const { errors, value } = validateSummaryQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const rows = await expenseTotalsByCategory(req.user.id, value);
  return res.json({ month: value.month, ...spendingByCategory(rows) });
}

// GET /api/summary/trend?month=YYYY-MM[&months=6] (US-44)
// Total expenses for each month ending at `month`, oldest first, 0 for empty months.
export async function handleGetSpendingTrend(req, res) {
  const { errors, value } = validateTrendQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const rows = await expenseTotalsByDay(req.user.id, value);
  return res.json({ month: value.month, months: expensesByMonth(value.months, rows) });
}

export const summaryRouter = Router();

summaryRouter.use(requireAuth);
summaryRouter.get('/', handleGetSummary);
summaryRouter.get('/categories', handleGetCategorySpending);
summaryRouter.get('/trend', handleGetSpendingTrend);
