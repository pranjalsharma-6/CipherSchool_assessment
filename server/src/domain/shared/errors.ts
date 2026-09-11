/**
 * Domain-level errors.
 *
 * These are thrown by entities and services that know nothing about HTTP.
 * The HTTP layer (infrastructure/http/errorHandler.ts) is the single place
 * that maps them onto status codes, so transport concerns never leak inward.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A requested aggregate does not exist. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';

  constructor(entity: string, id: string) {
    super(`${entity} '${id}' was not found`);
  }
}

/** The caller's input is structurally or semantically invalid. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.details = details;
  }
}

/**
 * The aggregate is in a state that forbids the requested operation,
 * e.g. submitting an attempt that has already been submitted.
 */
export class IllegalStateTransitionError extends DomainError {
  readonly code = 'ILLEGAL_STATE_TRANSITION';

  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot move from '${from}' to '${to}'`);
  }
}
