// An expected seed failure. Its message says what went wrong and what to do, and is
// printed on its own, without a stack trace.
export class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}
