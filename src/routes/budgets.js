// /api/budgets routes (US-31, US-33). Every route requires a logged-in user, and only
// ever reads or changes that user's own budgets.
//
// Handlers stay thin: check the request (../budgets/validation.js), make one
// repository call (../budgets/repository.js), send the response. Database errors that
// the client caused become 400, 401 or 409, so none of them turn into a 500.

import { Router } from 'express';
import { BUDGET_CATEGORIES } from '../constants.js';
import { ConflictError, HttpError, NotFoundError, UnauthorizedError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { deleteBudget, insertBudget, listBudgets, updateBudgetLimit } from '../budgets/repository.js';
import { validateBudgetId, validateBudgetUpdate, validateNewBudget } from '../budgets/validation.js';

// Postgres error codes, and the constraint names from db/migrations/005_create_budgets.sql.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
export const BUDGET_CONSTRAINTS = Object.freeze({
  oneBudgetPerCategory: 'budgets_user_id_category_key',
  user: 'budgets_user_id_fkey',
  category: 'budgets_category_fkey',
  positiveLimit: 'budgets_limit_cents_positive',
});

// Sent whether the budget doesn't exist or belongs to someone else.
const BUDGET_NOT_FOUND = 'Budget not found.';

const violates = (err, code, constraint) => err?.code === code && err.constraint === constraint;

/**
 * The response for a database error the client caused, or null for anything else.
 * Validation catches most of these first; this covers what only the database can know
 * (a duplicate category) and anything that ever slips past validation.
 *
 * @param {Error} err
 * @param {string} [category] The category being added, for the 409 message.
 * @returns {HttpError | { errors: Record<string, string> } | null} An error to throw,
 *   a 400 body to send, or null.
 */
function clientErrorFor(err, category) {
  if (violates(err, UNIQUE_VIOLATION, BUDGET_CONSTRAINTS.oneBudgetPerCategory)) {
    return new ConflictError(`You already have a budget for ${category}. Change that one instead.`);
  }
  if (violates(err, FOREIGN_KEY_VIOLATION, BUDGET_CONSTRAINTS.user)) {
    // The token was valid but its user has since been deleted.
    return new UnauthorizedError('User account no longer exists. Log in again.');
  }
  if (violates(err, FOREIGN_KEY_VIOLATION, BUDGET_CONSTRAINTS.category)) {
    return { errors: { category: `category must be one of: ${BUDGET_CATEGORIES.join(', ')}.` } };
  }
  if (violates(err, CHECK_VIOLATION, BUDGET_CONSTRAINTS.positiveLimit)) {
    return { errors: { limit_cents: 'limit_cents must be greater than zero.' } };
  }
  return null;
}

// Sends the 400, or throws the HttpError, for a database error; rethrows anything else.
function handleDatabaseError(err, res, category) {
  const clientError = clientErrorFor(err, category);
  if (!clientError) throw err;
  if (clientError instanceof HttpError) throw clientError;
  return res.status(400).json(clientError);
}

// GET /api/budgets
export async function handleListBudgets(req, res) {
  const budgets = await listBudgets(req.user.id);
  return res.json({ budgets });
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
    return handleDatabaseError(err, res, value.category);
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
    return handleDatabaseError(err, res);
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
budgetsRouter.post('/', handleCreateBudget);
budgetsRouter.put('/:id', handleUpdateBudget);
budgetsRouter.delete('/:id', handleDeleteBudget);
