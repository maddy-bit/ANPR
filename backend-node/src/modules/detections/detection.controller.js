/**
 * Detection Controller
 */

const detectionService = require('./detection.service');

async function ingest(req, res, next) {
  try {
    const result = await detectionService.ingestBatch([req.body]);
    const detection = result.detections[0];
    const status = result.statuses[0];
    const httpStatus = status === 'CREATED' ? 201 : 200;
    return res.status(httpStatus).json(detection);
  } catch (err) {
    return next(err);
  }
}

async function ingestBatch(req, res, next) {
  try {
    const requests = Array.isArray(req.body) ? req.body : [req.body];
    const result = await detectionService.ingestBatch(requests);
    const hasCreated = result.statuses.includes('CREATED');
    const httpStatus = hasCreated ? 201 : 200;
    return res.status(httpStatus).json(result.detections);
  } catch (err) {
    return next(err);
  }
}

async function getCandidates(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const minSpeedKmh = parseFloat(req.query.minSpeedKmh) || 5.0;
    const maxSpeedKmh = parseFloat(req.query.maxSpeedKmh) || 100.0;
    const maxTimeWindowSec = parseFloat(req.query.maxTimeWindowSec) || 7200.0;
    const feasibleOnly = req.query.feasibleOnly === 'true';

    const response = await detectionService.findCandidates(
      id,
      minSpeedKmh,
      maxSpeedKmh,
      maxTimeWindowSec,
      feasibleOnly
    );
    return res.json(response);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  ingest,
  ingestBatch,
  getCandidates,
};
