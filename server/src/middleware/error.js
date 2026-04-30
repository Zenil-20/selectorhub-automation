import { logger } from '../logger.js';

// Last-resort handler — anything that bubbles up here gets a structured
// JSON response and a single logged line. Status defaults to 500 unless
// the error carries one (services throw `Object.assign(err, { status })`).
export function errorMiddleware(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error('request.error', {
      method: req.method, path: req.path, status, msg: err.message, stack: err.stack,
    });
  } else {
    logger.warn('request.refused', { method: req.method, path: req.path, status, msg: err.message });
  }
  const body = { ok: false, error: err.message || 'Internal error' };
  if (err.code) body.code = err.code;
  if (err.validationErrors) body.validationErrors = err.validationErrors;
  res.status(status).json(body);
}
