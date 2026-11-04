// /api/goals routes (US-47). Every route requires a logged-in user, and only ever reads
// or changes that user's own savings goals.
//
// Handlers stay thin: check the request (../goals/validation.js), make one repository
// call (../goals/repository.js), send the response. Database errors that the client
// caused become 400 or 401, so none of them turn into a 500.

import { Router } from 'express';
import { HttpError, NotFoundError, UnauthorizedError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { deleteGoal, insertGoal, listGoals, updateGoal, addGoalContribution } from '../goals/repository.js';
import { MAX_GOAL_NAME_LENGTH, validateGoalBody, validateGoalId } from '../goals/validation.js';
import { validatePositiveCents } from '../transactions/validation.js';

// Postgres error codes, and the constraint names from db/migrations/006_create_goals.sql.
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
export const GOAL_CONSTRAINTS = Object.freeze({
  user: 'goals_user_id_fkey',
  positiveTarget: 'goals_target_cents_positive',
  // Only contributions (US-49) change saved_cents, so these routes can't break it.
  nonNegativeSaved: 'goals_saved_cents_nonnegative',
  nameLength: 'goals_name_length',
});

// Sent whether the goal doesn't exist or belongs to someone else.
const GOAL_NOT_FOUND = 'Goal not found.';

const violates = (err, code, constraint) => err?.code === code && err.constraint === constraint;

/**
 * The response for a database error the client caused, or null for anything else.
 * Validation catches these first; this covers anything that ever slips past it.
 *
 * @param {Error} err
 * @returns {HttpError | { errors: Record<string, string> } | null} An error to throw,
 *   a 400 body to send, or null.
 */
function clientErrorFor(err) {
  if (violates(err, FOREIGN_KEY_VIOLATION, GOAL_CONSTRAINTS.user)) {
    // The token was valid but its user has since been deleted.
    return new UnauthorizedError('User account no longer exists. Log in again.');
  }
  if (violates(err, CHECK_VIOLATION, GOAL_CONSTRAINTS.positiveTarget)) {
    return { errors: { target_cents: 'target_cents must be greater than zero.' } };
  }
  if (violates(err, CHECK_VIOLATION, GOAL_CONSTRAINTS.nameLength)) {
    return { errors: { name: `name must be 1 to ${MAX_GOAL_NAME_LENGTH} characters.` } };
  }
  return null;
}

// Sends the 400, or throws the HttpError, for a database error; rethrows anything else.
function handleDatabaseError(err, res) {
  const clientError = clientErrorFor(err);
  if (!clientError) throw err;
  if (clientError instanceof HttpError) throw clientError;
  return res.status(400).json(clientError);
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
    return handleDatabaseError(err, res);
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
    return handleDatabaseError(err, res);
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

export async function handleAddContribution(req, res) {
  const errors = {};
  const idError = validateGoalId(req.params.id);

  if (idError) errors.id = idError;

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.body = 'Request body must be a JSON object.';
  } else {
    const amountError = validatePositiveCents(
      body.amount_cents,
      'amount_cents'
    );
    if (amountError) errors.amount_cents = amountError;
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ errors });
  }

  const result = await addGoalContribution(
    req.user.id,
    req.params.id,
    body.amount_cents
  );

  if (result.limitReached) {
    return res.status(400).json({
      errors: {
        amount_cents: 'This contribution would exceed the maximum saved total.',
      },
    });
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
