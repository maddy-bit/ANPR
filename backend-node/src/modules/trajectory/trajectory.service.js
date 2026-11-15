/**
 * Trajectory Reconstruction Engine
 * Reconstructs vehicle trajectory from chronological detections with geographic
 * distance calculation, speed validation, and transition feasibility scoring.
 */

const vehicleRepo = require('../vehicles/vehicle.repository');
const { haversineDistanceKm, calculateSpeedKmh } = require('../../utils/geo-utils');

async function reconstructTrajectory(normalizedPlate) {
  const detections = await vehicleRepo.findDetectionsByPlate(normalizedPlate);
  if (!detections || detections.length === 0) {
    const err = new Error(`No vehicle found for plate: ${normalizedPlate}`);
    err.status = 404;
    throw err;
  }

  const points = detections.map(d => ({
    detectionId: Number(d.id),
    cameraId: d.cameraId,
    cameraName: d.cameraName || d.cameraId,
    latitude: Number(d.latitude),
    longitude: Number(d.longitude),
    timestamp: d.timestamp,
    confidence: Number(d.confidence) || 0.9,
    vehicleType: d.vehicleType || 'car',
    color: d.vehicleColor || null,
    evidencePath: d.evidencePath || null,
    reidDistance: null,
  }));

  const transitions = [];
  let totalDistanceKm = 0.0;
  let totalDurationMinutes = 0.0;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];

    const distKm = haversineDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude);
    const fromTime = new Date(from.timestamp).getTime();
    const toTime = new Date(to.timestamp).getTime();
    const durationSec = Math.max(0.1, (toTime - fromTime) / 1000.0);
    const durationMinutes = durationSec / 60.0;
    const speedKmh = calculateSpeedKmh(distKm, durationSec);

    // Feasibility scoring
    const speedFeasible = speedKmh <= 120.0;
    const directionFeasible = true;
    let score = 1.0;
    if (speedKmh > 120.0) score *= 0.5;
    if (speedKmh > 160.0) score *= 0.1;

    transitions.push({
      fromCameraId: from.cameraId,
      toCameraId: to.cameraId,
      distanceKm: Math.round(distKm * 100) / 100,
      durationMinutes: Math.round(durationMinutes * 10) / 10,
      impliedSpeedKmh: Math.round(speedKmh * 10) / 10,
      score: {
        impliedSpeedKmh: Math.round(speedKmh * 10) / 10,
        speedFeasible,
        directionFeasible,
        overallFeasibilityScore: Math.round(score * 100) / 100,
      },
    });

    totalDistanceKm += distKm;
    totalDurationMinutes += durationMinutes;
  }

  // Calculate average confidence
  const avgConfidence = points.reduce((acc, p) => acc + p.confidence, 0.0) / points.length;

  return {
    plate: normalizedPlate,
    points,
    transitions,
    overallConfidence: Math.round(avgConfidence * 100) / 100,
    estimatedDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    estimatedDurationMinutes: Math.round(totalDurationMinutes * 10) / 10,
  };
}

module.exports = {
  reconstructTrajectory,
};
