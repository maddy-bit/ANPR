/**
 * Vehicle Controller
 */

const vehicleRepo = require('./vehicle.repository');
const auditService = require('../audit/audit.service');
const { normalize } = require('../../utils/plate-normalizer');

async function getRecentVehicles(req, res, next) {
  try {
    const vehicles = await vehicleRepo.findTop10Recent();
    return res.json(vehicles);
  } catch (err) {
    return next(err);
  }
}

async function getVehicle(req, res, next) {
  try {
    const rawPlate = req.params.plate;
    const normalized = normalize(rawPlate);

    await auditService.record('VEHICLE_SEARCH', normalized, req);

    const vehicle = await vehicleRepo.findByPlate(normalized);
    if (!vehicle) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `No vehicle found for plate: ${normalized}` });
    }

    const detections = await vehicleRepo.findDetectionsByPlate(normalized);

    if (detections.length === 0) {
      return res.json({
        vehicle,
        firstSeen: null,
        lastSeen: null,
        cameraCount: 0,
        camerasVisited: [],
        detectionCount: 0,
      });
    }

    const visitedSet = new Set(detections.map(d => d.cameraId));
    const camerasVisited = Array.from(visitedSet);

    return res.json({
      vehicle,
      firstSeen: detections[0].timestamp,
      lastSeen: detections[detections.length - 1].timestamp,
      cameraCount: camerasVisited.length,
      camerasVisited,
      detectionCount: detections.length,
    });
  } catch (err) {
    return next(err);
  }
}

async function getDetections(req, res, next) {
  try {
    const rawPlate = req.params.plate;
    const normalized = normalize(rawPlate);
    const detections = await vehicleRepo.findDetectionsByPlate(normalized);
    return res.json(detections);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getRecentVehicles,
  getVehicle,
  getDetections,
};
