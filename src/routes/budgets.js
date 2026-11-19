// /api/budgets routes (US-31, US-33, US-35). Every route requires a logged-in user, and
// only ever reads or changes that user's own budgets and spending.
//
// Handlers stay thin: check the request (../budgets/validation.js), call the
// repository (../budgets/repository.js), send the response. Database errors that the
// client caused become 400, 401 or 409, so none of them turn into a 500.

import { Router } from 'express';
import { BUDGET_CATEGORIES } from '../constants.js';
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  respondToDatabaseError,
  userGoneError,
  violates,
} from '../databaseErrors.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  deleteBudget,
  expenseTotalsByCategory,
  insertBudget,
  listBudgets,
  updateBudgetLimit,
} from '../budgets/repository.js';
import { summarizeBudgets } from '../budgets/status.js';
import { LABELS, validateBudgetId, validateBudgetUpdate, validateNewBudget } from '../budgets/validation.js';
import { validateSummaryQuery } from '../summary/validation.js';
import { MESSAGES } from '../validation/rules.js';

// The constraint names from db/migrations/005_create_budgets.sql.
export const BUDGET_CONSTRAINTS = Object.freeze({
  oneBudgetPerCategory: 'budgets_user_id_category_key',
  user: 'budgets_user_id_fkey',
  category: 'budgets_category_fkey',
  positiveLimit: 'budgets_limit_cents_positive',
});

// Sent whether the budget doesn't exist or belongs to someone else.
const BUDGET_NOT_FOUND = 'Budget not found.';

/**
 * The response for a database error the client caused, or null for anything else.
 * Validation catches most of these first; this covers what only the database can know
 * (a duplicate category) and anything that ever slips past validation.
 *
 * @param {Error} err
 * @param {string} [category] The category being added, for the 409 message.
 * @returns {import('../errors.js').HttpError | { errors: Record<string, string> } | null} An error to throw,
 *   a 400 body to send, or null.
 */
function clientErrorFor(err, category) {
  if (violates(err, UNIQUE_VIOLATION, BUDGET_CONSTRAINTS.oneBudgetPerCategory)) {
    return new ConflictError(`You already have a budget for ${category}. Change that one instead.`);
  }
  if (violates(err, FOREIGN_KEY_VIOLATION, BUDGET_CONSTRAINTS.user)) {
    return userGoneError();
  }
  if (violates(err, FOREIGN_KEY_VIOLATION, BUDGET_CONSTRAINTS.category)) {
    return { errors: { category: MESSAGES.choice(LABELS.category, BUDGET_CATEGORIES) } };
  }
  if (violates(err, CHECK_VIOLATION, BUDGET_CONSTRAINTS.positiveLimit)) {
    return { errors: { limit_cents: MESSAGES.positive(LABELS.limit_cents) } };
  }
  return null;
}

// GET /api/budgets
export async function handleListBudgets(req, res) {
  const budgets = await listBudgets(req.user.id);
  return res.json({ budgets });
}

// GET /api/budgets/status?month=YYYY-MM
// Spent, remaining and percent used for each budget in one month. Limits aren't kept
// per month, so every month is compared with the current limits.
export async function handleGetBudgetStatus(req, res) {
  const { errors, value } = validateSummaryQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const [budgets, spending] = await Promise.all([
    listBudgets(req.user.id),
    expenseTotalsByCategory(req.user.id, value),
  ]);
  return res.json({ month: value.month, budgets: summarizeBudgets(budgets, spending) });
}

// POST /api/budgets
export async function handleCreateBudget(req, res) {
  const { errors, value } = validateNewBudget(req.body);
  if (errors) {
    return res.status(400).json({ errors });
  }

  try {
    const budget = await insertBudget(req.user.id, value);
    return res.status(201).json({ budget });
  } catch (err) {
    return respondToDatabaseError(err, res, clientErrorFor(err, value.category));
  }
}

// PUT /api/budgets/:id
export async function handleUpdateBudget(req, res) {
  const idError = validateBudgetId(req.params.id);
  const { errors: bodyErrors, value } = validateBudgetUpdate(req.body);
  if (idError || bodyErrors) {
    // Report a bad id together with any body errors, so every problem shows at once.
    const errors = idError ? { id: idError, ...bodyErrors } : bodyErrors;
    return res.status(400).json({ errors });
  }

  let budget;
  try {
    budget = await updateBudgetLimit(req.user.id, req.params.id, value.limit_cents);
  } catch (err) {
    return respondToDatabaseError(err, res, clientErrorFor(err));
  }
  if (!budget) {
    throw new NotFoundError(BUDGET_NOT_FOUND);
  }
  return res.json({ budget });
}

// DELETE /api/budgets/:id
export async function handleDeleteBudget(req, res) {
  const idError = validateBudgetId(req.params.id);
  if (idError) {
    return res.status(400).json({ errors: { id: idError } });
  }

  const wasDeleted = await deleteBudget(req.user.id, req.params.id);
  if (!wasDeleted) {
    throw new NotFoundError(BUDGET_NOT_FOUND);
  }
  return res.status(204).end();
}

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);
budgetsRouter.get('/', handleListBudgets);
// Must stay above every /:id route. Express tries routes in order, so a GET /:id
// added before it would read "status" as a budget id.
budgetsRouter.get('/status', handleGetBudgetStatus);
budgetsRouter.post('/', handleCreateBudget);
budgetsRouter.put('/:id', handleUpdateBudget);
budgetsRouter.delete('/:id', handleDeleteBudget);
