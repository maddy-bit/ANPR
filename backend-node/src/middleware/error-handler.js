/**
 * Central Error Handler Middleware
 */

const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) {
    logger.error({ err, path: req.path, method: req.method, requestId: req.requestId }, 'Unhandled server error');
  } else {
    logger.warn({ path: req.path, method: req.method, status, message, requestId: req.requestId }, 'Client request rejected');
  }

  // Client-facing messages: application errors (4xx) carry their own user-safe
  // messages; internal failures (5xx) must not leak stack details, SQL text or
  // filesystem paths to callers — a generic message is returned and the full
  // error stays server-side in the logs.
  const responseBody = {
    error: err.code || (status === 404 ? 'NOT_FOUND' : status === 400 ? 'BAD_REQUEST' : status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'INTERNAL_SERVER_ERROR'),
    message: status >= 500 ? 'Internal server error. The incident has been logged.' : message,
    requestId: req.requestId || null,
    timestamp: new Date().toISOString(),
  };

  if (err.idempotencyKey) {
    responseBody.idempotencyKey = err.idempotencyKey;
  }

  res.status(status).json(responseBody);
}

module.exports = {
  errorHandler,
};
