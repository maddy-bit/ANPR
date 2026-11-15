/**
 * Trajectory Controller
 */

const trajectoryService = require('./trajectory.service');
const auditService = require('../audit/audit.service');
const { normalize } = require('../../utils/plate-normalizer');

async function getVehicleTrajectory(req, res, next) {
  try {
    const rawPlate = req.params.plate;
    const normalized = normalize(rawPlate);

    await auditService.record('TRAJECTORY_VIEW', normalized, req);

    const trajectory = await trajectoryService.reconstructTrajectory(normalized);
    return res.json(trajectory);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getVehicleTrajectory,
};
