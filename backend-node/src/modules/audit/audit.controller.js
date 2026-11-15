/**
 * Audit Controller
 */

const auditRepo = require('./audit.repository');

async function recent(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const entries = await auditRepo.findRecent(limit);
    return res.json(entries);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  recent,
};
