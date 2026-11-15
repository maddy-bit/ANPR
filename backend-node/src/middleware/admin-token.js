/**
 * Admin Token Guard (destructive / compute-triggering operations)
 *
 * Opt-in enforcement: when ADMIN_API_TOKEN is configured, requests to
 * protected routes must present the matching token in the x-admin-token
 * header (constant-time comparison). When the token is NOT configured the
 * guard is inert and a loud warning is logged — local development keeps
 * working, but the warning makes the unguarded state explicit.
 *
 * Production deployments must set ADMIN_API_TOKEN (see SECURITY_AUDIT.md).
 */

const crypto = require('crypto');
const config = require('../config/env');
const logger = require('../config/logger');

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function warnIfUnguarded() {
  if (!config.security.adminApiToken) {
    logger.warn(
      'ADMIN_API_TOKEN is not configured: administrative routes, including video processing and camera-source management, ' +
      'are not token-protected in development. Configure ADMIN_API_TOKEN before any production deployment.'
    );
  }
}

function adminTokenGuard(req, res, next) {
  if (!config.security.adminApiToken) {
    if (config.env === 'production') {
      return res.status(503).json({
        error: 'ADMIN_AUTH_NOT_CONFIGURED',
        message: 'Administrative API operations are unavailable until ADMIN_API_TOKEN is configured',
      });
    }
    return next();
  }

  const provided = req.headers['x-admin-token'];
  if (constantTimeEqual(provided, config.security.adminApiToken)) {
    return next();
  }

  return res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Valid x-admin-token header required for this operation',
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  adminTokenGuard,
  warnIfUnguarded,
};
