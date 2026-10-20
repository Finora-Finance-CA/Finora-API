// /api/summary: the logged-in user's totals for one month (US-27). Requires a token,
// and only ever counts that user's transactions.

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { totalsByType } from '../summary/repository.js';
import { summarizeTotals } from '../summary/totals.js';
import { validateSummaryQuery } from '../summary/validation.js';

// GET /api/summary?month=YYYY-MM
export async function handleGetSummary(req, res) {
  const { errors, value } = validateSummaryQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const rows = await totalsByType(req.user.id, value);
  return res.json({ month: value.month, ...summarizeTotals(rows) });
}

export const summaryRouter = Router();

summaryRouter.use(requireAuth);
summaryRouter.get('/', handleGetSummary);
