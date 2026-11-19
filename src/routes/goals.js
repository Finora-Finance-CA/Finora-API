// /api/goals routes (US-47, US-49). Every route requires a logged-in user, and only ever
// reads or changes that user's own savings goals.
//
// Handlers stay thin: check the request (../goals/validation.js), make one repository
// call (../goals/repository.js), send the response. Database errors that the client
// caused become 400 or 401, so none of them turn into a 500.

import { Router } from 'express';
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  respondToDatabaseError,
  userGoneError,
  violates,
} from '../databaseErrors.js';
import { NotFoundError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { deleteGoal, insertGoal, listGoals, updateGoal, addGoalContribution } from '../goals/repository.js';
import {
  LABELS,
  MAX_GOAL_NAME_LENGTH,
  validateContribution,
  validateGoalBody,
  validateGoalId,
} from '../goals/validation.js';
import { MESSAGES } from '../validation/rules.js';

// The constraint names from db/migrations/006_create_goals.sql.
export const GOAL_CONSTRAINTS = Object.freeze({
  user: 'goals_user_id_fkey',
  positiveTarget: 'goals_target_cents_positive',
  // Only contributions (US-49) change saved_cents, so these routes can't break it.
  nonNegativeSaved: 'goals_saved_cents_nonnegative',
  nameLength: 'goals_name_length',
});

// Sent whether the goal doesn't exist or belongs to someone else.
const GOAL_NOT_FOUND = 'Goal not found.';

// A contribution that would take saved_cents past what the API can return exactly.
export const SAVED_TOTAL_LIMIT = 'This contribution would exceed the maximum saved total.';

/**
 * The response for a database error the client caused, or null for anything else.
 * Validation catches these first; this covers anything that ever slips past it.
 *
 * @param {Error} err
 * @returns {import('../errors.js').HttpError | { errors: Record<string, string> } | null} An error to throw,
 *   a 400 body to send, or null.
 */
function clientErrorFor(err) {
  if (violates(err, FOREIGN_KEY_VIOLATION, GOAL_CONSTRAINTS.user)) {
    return userGoneError();
  }
  if (violates(err, CHECK_VIOLATION, GOAL_CONSTRAINTS.positiveTarget)) {
    return { errors: { target_cents: MESSAGES.positive(LABELS.target_cents) } };
  }
  if (violates(err, CHECK_VIOLATION, GOAL_CONSTRAINTS.nameLength)) {
    return { errors: { name: MESSAGES.maxLength(LABELS.name, MAX_GOAL_NAME_LENGTH) } };
  }
  return null;
}

// GET /api/goals
export async function handleListGoals(req, res) {
  const goals = await listGoals(req.user.id);
  return res.json({ goals });
}

// POST /api/goals
export async function handleCreateGoal(req, res) {
  const { errors, value } = validateGoalBody(req.body);
  if (errors) {
    return res.status(400).json({ errors });
  }

  try {
    const goal = await insertGoal(req.user.id, value);
    return res.status(201).json({ goal });
  } catch (err) {
    return respondToDatabaseError(err, res, clientErrorFor(err));
  }
}

// PUT /api/goals/:id
export async function handleUpdateGoal(req, res) {
  const idError = validateGoalId(req.params.id);
  const { errors: bodyErrors, value } = validateGoalBody(req.body);
  if (idError || bodyErrors) {
    // Report a bad id together with any body errors, so every problem shows at once.
    const errors = idError ? { id: idError, ...bodyErrors } : bodyErrors;
    return res.status(400).json({ errors });
  }

  let goal;
  try {
    goal = await updateGoal(req.user.id, req.params.id, value);
  } catch (err) {
    return respondToDatabaseError(err, res, clientErrorFor(err));
  }
  if (!goal) {
    throw new NotFoundError(GOAL_NOT_FOUND);
  }
  return res.json({ goal });
}

// DELETE /api/goals/:id
export async function handleDeleteGoal(req, res) {
  const idError = validateGoalId(req.params.id);
  if (idError) {
    return res.status(400).json({ errors: { id: idError } });
  }

  const wasDeleted = await deleteGoal(req.user.id, req.params.id);
  if (!wasDeleted) {
    throw new NotFoundError(GOAL_NOT_FOUND);
  }
  return res.status(204).end();
}

// POST /api/goals/:id/contributions (US-49)
// Adds { amount_cents } to the owner's goal and returns the goal with its new total.
export async function handleAddContribution(req, res) {
  const { errors, value } = validateContribution(req.params.id, req.body);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const result = await addGoalContribution(req.user.id, req.params.id, value.amount_cents);
  if (result.limitReached) {
    return res.status(400).json({ errors: { amount_cents: SAVED_TOTAL_LIMIT } });
  }
  if (!result.goal) {
    throw new NotFoundError(GOAL_NOT_FOUND);
  }
  return res.json({ goal: result.goal });
}

export const goalsRouter = Router();

goalsRouter.use(requireAuth);
goalsRouter.post('/:id/contributions', handleAddContribution);
goalsRouter.get('/', handleListGoals);
goalsRouter.post('/', handleCreateGoal);
goalsRouter.put('/:id', handleUpdateGoal);
goalsRouter.delete('/:id', handleDeleteGoal);
