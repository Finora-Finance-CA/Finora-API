// Validation for transaction request bodies. Pure functions with no Express or
// database dependencies, so they can be unit tested directly.

// These lists mirror the CHECK constraints in db/migrations/002_create_transactions.sql.
// If a migration changes them, update these too.
export const TRANSACTION_TYPES = Object.freeze(['income', 'expense']);
export const CATEGORIES = Object.freeze(['Food', 'Transportation', 'Housing', 'Entertainment', 'Other']);

// Largest value a Postgres INTEGER column can hold.
export const MAX_AMOUNT_CENTS = 2_147_483_647;
export const MAX_DESCRIPTION_LENGTH = 255;
export const MIN_YEAR = 1900;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function validateAmountCents(value) {
  if (isMissing(value)) return 'amount_cents is required.';
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return 'amount_cents must be a whole number of cents, e.g. 1250 for $12.50.';
  }
  if (value <= 0) return 'amount_cents must be greater than zero.';
  if (value > MAX_AMOUNT_CENTS) return `amount_cents must be at most ${MAX_AMOUNT_CENTS}.`;
  return null;
}

function validateDate(value) {
  if (isMissing(value)) return 'date is required.';
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) return 'date must be a string in YYYY-MM-DD format.';

  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC rolls invalid days over (Feb 30 becomes Mar 2), so compare the parts back.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!isRealDate) return 'date must be a real calendar date.';
  if (year < MIN_YEAR) return `date must be in ${MIN_YEAR} or later.`;
  return null;
}

function validateType(value) {
  if (isMissing(value)) return 'type is required.';
  if (!TRANSACTION_TYPES.includes(value)) return `type must be one of: ${TRANSACTION_TYPES.join(', ')}.`;
  return null;
}

function validateCategory(value, type) {
  if (isMissing(value)) {
    return type === 'expense' ? 'category is required for an expense.' : null;
  }
  if (!CATEGORIES.includes(value)) return `category must be one of: ${CATEGORIES.join(', ')}.`;
  return null;
}

function validateDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'description must be a string.';
  if (value.trim().length > MAX_DESCRIPTION_LENGTH) {
    return `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  return null;
}

/**
 * Validates the body of a create transaction request.
 *
 * Only the known fields are read; anything else (including user_id) is ignored.
 *
 * @param {unknown} body The parsed JSON request body.
 * @returns {{ errors: Record<string, string> } | { errors: null, value: object }}
 *   Either every invalid field with a message, or the cleaned values ready to insert.
 */
export function validateCreateTransaction(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { body: 'Request body must be a JSON object. Set Content-Type: application/json.' } };
  }

  const { amount_cents, date, type, category, description } = body;
  const checks = {
    amount_cents: validateAmountCents(amount_cents),
    date: validateDate(date),
    type: validateType(type),
    category: validateCategory(category, type),
    description: validateDescription(description),
  };

  const errors = Object.fromEntries(Object.entries(checks).filter(([, message]) => message !== null));
  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const trimmedDescription = typeof description === 'string' ? description.trim() : '';
  return {
    errors: null,
    value: {
      amount_cents,
      date,
      type,
      category: isMissing(category) ? null : category,
      description: trimmedDescription === '' ? null : trimmedDescription,
    },
  };
}
