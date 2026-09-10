/**
 * The lifecycle of one practice attempt.
 *
 * Evaluation is asynchronous (an LLM call is slow and can fail), so the states
 * a learner sees are the real states of the work, not a spinner: the attempt is
 * queued, being looked at, done, or it broke and can be retried.
 */
export const ATTEMPT_STATUSES = [
  'draft',
  'queued',
  'evaluating',
  'evaluated',
  'failed',
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * The single source of truth for what may follow what.
 *
 * Keeping this as a table rather than scattering `if (status === ...)` through
 * the services means an illegal transition is impossible to express, and adding
 * a state later (say `expired`) is one edit in one place.
 */
export const ALLOWED_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  draft: ['queued'],
  // Re-queued rather than lost if the worker dies before picking the job up.
  queued: ['evaluating', 'failed'],
  // Back to `queued` on a retryable failure; `failed` once retries run out.
  evaluating: ['evaluated', 'queued', 'failed'],
  // Terminal for this attempt: improving means starting a new attempt.
  evaluated: [],
  // The learner can ask for another go at evaluation without re-typing.
  failed: ['queued'],
};

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses where the client should keep polling. */
export function isPending(status: AttemptStatus): boolean {
  return status === 'queued' || status === 'evaluating';
}
