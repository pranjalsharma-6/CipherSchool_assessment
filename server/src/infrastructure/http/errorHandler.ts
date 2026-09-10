import type { ErrorRequestHandler, RequestHandler } from 'express';
import {
  DomainError,
  IllegalStateTransitionError,
  NotFoundError,
  ValidationError,
} from '../../domain/shared/errors.js';

/** Maps domain errors onto status codes — the only place that knows both. */
const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  ILLEGAL_STATE_TRANSITION: 409,
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code] ?? 400;
    res.status(status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof ValidationError && error.details.length > 0
          ? { details: error.details }
          : {}),
      },
    });
    return;
  }

  // Anything unmapped is a bug: log it in full, tell the client nothing.
  console.error('unhandled_error', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong evaluating that request.' },
  });
};

export { IllegalStateTransitionError, NotFoundError, ValidationError };
