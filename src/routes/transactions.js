// /api/transactions routes. Every route here requires a logged-in user.
//
// Each handler only validates the request, calls one repository function and sends
// the response. Rules live in ../transactions/validation.js and SQL in ../transactions/repository.js.

import { Router } from 'express';
import { NotFoundError, UnauthorizedError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  deleteTransaction,
  insertTransaction,
  listTransactions,
  updateTransaction,
} from '../transactions/repository.js';
import { validateTransactionBody, validateTransactionId } from '../transactions/validation.js';

// Postgres error code for a foreign key violation.
const FOREIGN_KEY_VIOLATION = '23503';

// Kept small on purpose: paging, search and filters are Sprint 2 stories.
export const TRANSACTION_LIST_LIMIT = 50;

// Sent whether the transaction doesn't exist or belongs to someone else, so other
// users' transaction ids can't be discovered.
const TRANSACTION_NOT_FOUND = 'Transaction not found.';

// GET /api/transactions
export async function handleListTransactions(req, res) {
  const transactions = await listTransactions(req.user.id, TRANSACTION_LIST_LIMIT);
  return res.json({ transactions });
}

// POST /api/transactions
export async function handleCreateTransaction(req, res) {
  const { errors, value } = validateTransactionBody(req.body);
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

// PUT /api/transactions/:id
export async function handleUpdateTransaction(req, res) {
  const idError = validateTransactionId(req.params.id);
  const { errors: bodyErrors, value } = validateTransactionBody(req.body);
  if (idError || bodyErrors) {
    // Report a bad id together with any body errors, so every problem shows at once.
    const errors = idError ? { id: idError, ...bodyErrors } : bodyErrors;
    return res.status(400).json({ errors });
  }

  const transaction = await updateTransaction(req.user.id, req.params.id, value);
  if (!transaction) {
    throw new NotFoundError(TRANSACTION_NOT_FOUND);
  }
  return res.json({ transaction });
}

// DELETE /api/transactions/:id
export async function handleDeleteTransaction(req, res) {
  const idError = validateTransactionId(req.params.id);
  if (idError) {
    return res.status(400).json({ errors: { id: idError } });
  }

  const wasDeleted = await deleteTransaction(req.user.id, req.params.id);
  if (!wasDeleted) {
    throw new NotFoundError(TRANSACTION_NOT_FOUND);
  }
  return res.status(204).end();
}

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);
transactionsRouter.get('/', handleListTransactions);
transactionsRouter.post('/', handleCreateTransaction);
transactionsRouter.put('/:id', handleUpdateTransaction);
transactionsRouter.delete('/:id', handleDeleteTransaction);
