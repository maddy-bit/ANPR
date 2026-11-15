/**
 * Analytics Controller
 */

const analyticsService = require('./analytics.service');

async function overview(req, res, next) {
  try {
    const data = await analyticsService.overview();
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  overview,
};
