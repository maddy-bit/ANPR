/**
 * Request Correlation ID Middleware
 *
 * Assigns a unique ID to every request for end-to-end tracing across logs,
 * error responses and upstream AI-service calls. Honors an incoming
 * x-request-id header (e.g. from a reverse proxy) after sanitizing it;
 * otherwise generates a UUID.
 */

const crypto = require('crypto');

const HEADER = 'x-request-id';
const MAX_LENGTH = 128;
const VALID_PATTERN = /^[A-Za-z0-9._-]+$/;

function correlationId(req, res, next) {
  const incoming = req.headers[HEADER];
  const requestId =
    typeof incoming === 'string' && incoming.length <= MAX_LENGTH && VALID_PATTERN.test(incoming)
      ? incoming
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(HEADER, requestId);
  next();
}

module.exports = {
  correlationId,
  HEADER,
};
