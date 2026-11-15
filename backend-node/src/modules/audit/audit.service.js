/**
 * Audit Log Service
 */

const auditRepo = require('./audit.repository');
const logger = require('../../config/logger');

async function record(action, details, req) {
  try {
    const ipAddress = req ? (req.ip || req.connection?.remoteAddress || '127.0.0.1') : '127.0.0.1';
    const userAgent = req ? (req.headers['user-agent'] || 'unknown') : 'system';
    const userId = (req && req.user && req.user.username) ? req.user.username : 'anonymous';

    return await auditRepo.create({
      action,
      details,
      userId,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });
  } catch (err) {
    logger.warn({ err: err.message, action }, 'Failed to record audit log entry');
    return null;
  }
}

module.exports = {
  record,
  findRecent: auditRepo.findRecent,
};
