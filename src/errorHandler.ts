import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

function getStatusCode(err: { status?: unknown; statusCode?: unknown }): number {
  const code = err.status ?? err.statusCode;
  return typeof code === 'number' && code >= 400 && code <= 599 ? code : 500;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Hand the real error to pino-http: its "request completed" line will carry it.
  res.err = err;

  // Response already started: we can't change status or headers, so let Express close it.
  if (res.headersSent) return next(err);

  let statusCode = getStatusCode(err);
  if (err instanceof ZodError) statusCode = 400;

  // Never expose internal error messages to clients on 5xx.
  const message =
    statusCode >= 500
      ? 'Internal Server Error'
      : err instanceof ZodError
        ? 'Invalid data provided'
        : err.message || 'Bad Request';

  res.status(statusCode).json({ success: false, error: message });
};
