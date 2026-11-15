/**
 * Basic Authentication Middleware for Ingestion & Audit Endpoints
 * Uses constant-time buffer comparison and robust colon parsing.
 */

const crypto = require('crypto');
const config = require('../config/env');

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="CityAI Ingest"');
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication credentials required',
    });
  }

  const base64Credentials = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = Buffer.from(base64Credentials, 'base64').toString('utf8');
  } catch (e) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Malformed authorization header' });
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid credentials format' });
  }

  const username = decoded.substring(0, colonIdx);
  const password = decoded.substring(colonIdx + 1);

  const userMatch = safeCompare(username, config.ingest.username);
  const passMatch = safeCompare(password, config.ingest.password);

  if (userMatch && passMatch) {
    req.user = { username, role: 'ROLE_INGEST' };
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="CityAI Ingest"');
  return res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Invalid credentials',
  });
}

module.exports = {
  basicAuth,
};
