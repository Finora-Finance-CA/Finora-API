// /api/transactions routes. Every route here requires a logged-in user, and only
// ever reads or changes that user's own transactions.
//
// Handlers stay thin: check the request (../transactions/validation.js), make one
// repository call (../transactions/repository.js), send the response. Errors thrown
// here are turned into JSON by the central error handler.

import { Router } from 'express';
import { FOREIGN_KEY_VIOLATION, respondToDatabaseError, userGoneError, violates } from '../databaseErrors.js';
import { NotFoundError } from '../errors.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  deleteTransaction,
  insertTransaction,
  listTransactions,
  updateTransaction,
} from '../transactions/repository.js';
import { CATEGORIES, TRANSACTION_PAGE_SIZE } from '../constants.js';
import { LABELS, validateListQuery, validateTransactionBody, validateTransactionId } from '../transactions/validation.js';
import { MESSAGES } from '../validation/rules.js';

// Sent whether the transaction doesn't exist or belongs to someone else.
const TRANSACTION_NOT_FOUND = 'Transaction not found.';

// The response for a database error the client caused, or null for anything else.
function clientErrorFor(err) {
  if (violates(err, FOREIGN_KEY_VIOLATION, 'transactions_user_id_fkey')) return userGoneError();
  // Validation already checks categories against CATEGORIES. If the categories table
  // ever stops matching it, the database rejects the row, and the user still gets a 400
  // instead of a 500.
  if (violates(err, FOREIGN_KEY_VIOLATION, 'transactions_category_fkey')) {
    return { errors: { category: MESSAGES.choice(LABELS.category, CATEGORIES) } };
  }
  return null;
}

// GET /api/transactions?page=&q=&category=&from=&to=
export async function handleListTransactions(req, res) {
  const { errors, value: filters } = validateListQuery(req.query);
  if (errors) {
    return res.status(400).json({ errors });
  }

  const pageSize = TRANSACTION_PAGE_SIZE;
  const { transactions, totalCount } = await listTransactions(req.user.id, filters, {
    limit: pageSize,
    offset: (filters.page - 1) * pageSize,
  });
  return res.json({
    transactions,
    pagination: {
      page: filters.page,
      page_size: pageSize,
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / pageSize),
    },
  });
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
    return respondToDatabaseError(err, res, clientErrorFor(err));
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

  let transaction;
  try {
    transaction = await updateTransaction(req.user.id, req.params.id, value);
  } catch (err) {
    return respondToDatabaseError(err, res, clientErrorFor(err));
  }
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
