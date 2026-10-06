// /api/transactions routes. Every route here requires a logged-in user.

import { Router } from 'express';
import { UnauthorizedError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { insertTransaction } from '../transactions/repository.js';
import { validateCreateTransaction } from '../transactions/validation.js';

// Postgres error code for a foreign key violation.
const FOREIGN_KEY_VIOLATION = '23503';

export async function createTransaction(req, res) {
  const { errors, value } = validateCreateTransaction(req.body);
  if (errors) {
    return res.status(400).json({ errors });
  }

  try {
    const transaction = await insertTransaction(req.user.id, value);
    return res.status(201).json({ transaction });
  } catch (err) {
    // The token was valid but its user has since been deleted.
    if (err.code === FOREIGN_KEY_VIOLATION && err.constraint === 'transactions_user_id_fkey') {
      throw new UnauthorizedError('User account no longer exists. Log in again.');
    }
    throw err;
  }
}

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);
transactionsRouter.post('/', createTransaction);
