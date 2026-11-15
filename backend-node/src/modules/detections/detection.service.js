/**
 * Detection Ingestion & Association Service
 */

const { withTransaction } = require('../../database/pool');
const detectionRepo = require('./detection.repository');
const vehicleRepo = require('../vehicles/vehicle.repository');
const cameraRepo = require('../cameras/camera.repository');
const { publish } = require('../../integrations/redis/client');
const { normalize } = require('../../utils/plate-normalizer');
const { haversineDistanceKm, calculateSpeedKmh } = require('../../utils/geo-utils');
const liveWs = require('../../websocket/live-tracking');

function parseEmbedding(str) {
  if (!str) return null;
  try {
    if (Array.isArray(str)) return str;
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0.0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function ingestBatch(requests) {
  return await withTransaction(async (client) => {
    const detections = [];
    const statuses = [];
    const sideEffects = [];

    for (const req of requests) {
      let vehicleId = null;
      let normalizedPlate = null;
      const rawPlate = req.plateTextNormalized || req.plateText || req.plateTextRaw || req.plate_text_normalized || req.plate_text_raw || null;
      if (rawPlate) {
        normalizedPlate = normalize(rawPlate);
        const vehicle = await vehicleRepo.upsert({
          plate: normalizedPlate,
          vehicleType: req.vehicleType || req.vehicleClass || null,
          color: req.vehicleColor || req.color || null,
        }, client);
        vehicleId = vehicle.id;
      }

      const cameraId = req.cameraId || req.camera_id;
      if (typeof cameraId !== 'string' || !cameraId.trim()) {
        const err = new Error('A cameraId is required for detection ingestion.');
        err.status = 422;
        throw err;
      }
      const detectionTime = req.timestamp == null || req.timestamp === '' ? null : new Date(req.timestamp);
      if (!detectionTime || Number.isNaN(detectionTime.getTime())) {
        const err = new Error('A valid capture/detection timestamp is required for ingestion.');
        err.status = 422;
        throw err;
      }

      // Stable fallback for callers that do not supply the upload/run event key.
      const idempotencyKey =
        req.idempotencyKey ||
        `${cameraId}_${detectionTime.toISOString()}_${req.frameNumber ?? req.frame_number ?? 'frame-unknown'}_${req.trackId ?? req.track_id ?? normalizedPlate ?? 'unidentified'}`;

      const res = await detectionRepo.insertDetection(
        {
          cameraId,
          vehicleId,
          timestamp: detectionTime,
          confidence: req.confidence ?? req.detectionConfidence ?? req.detection_confidence,
          plateTextRaw: req.plateTextRaw || req.plate_text_raw || req.plateText || normalizedPlate,
          plateText: normalizedPlate,
          plateConfidence: req.plateConfidence ?? req.plate_confidence ?? null,
          vehicleType: req.vehicleType || req.vehicleClass || req.vehicle_class || null,
          vehicleColor: req.vehicleColor || req.color || req.vehicle_color || null,
          latitude: req.latitude ?? null,
          longitude: req.longitude ?? null,
          direction: req.direction || null,
          speedKmh: req.speedKmh ?? req.speed_kmh ?? null,
          reidConfidence: req.reidConfidence ?? req.reid_confidence ?? null,
          bboxX1: req.bboxX1 ?? (req.bbox ? req.bbox[0] : null),
          bboxY1: req.bboxY1 ?? (req.bbox ? req.bbox[1] : null),
          bboxX2: req.bboxX2 ?? (req.bbox ? req.bbox[2] : null),
          bboxY2: req.bboxY2 ?? (req.bbox ? req.bbox[3] : null),
          plateBboxX1: req.plateBboxX1 || null,
          plateBboxY1: req.plateBboxY1 || null,
          plateBboxX2: req.plateBboxX2 || null,
          plateBboxY2: req.plateBboxY2 || null,
          evidencePath: req.evidencePath || req.imagePath || req.image_path || null,
          trackId: req.trackId ?? req.track_id ?? null,
          frameNumber: req.frameNumber ?? req.frame_number ?? null,
          videoUploadId: req.videoUploadId || req.video_upload_id || null,
          processingRunId: req.processingRunId || req.processing_run_id || null,
          idempotencyKey,
          reidEmbedding: req.reidEmbedding ? JSON.stringify(req.reidEmbedding) : (req.reid_embedding ? JSON.stringify(req.reid_embedding) : null),
          reidModelName: req.reidModelName || req.reid_model_name || null,
          reidModelVersion: req.reidModelVersion || req.reid_model_version || null,
          reidDimension: req.reidDimension ?? req.reid_dimension ?? null,
          globalIdentityId: req.globalIdentityId || req.global_identity_id || null,
        },
        client
      );

      detections.push(res.detection);
      statuses.push(res.status);

      if (res.status === 'CREATED') {
        sideEffects.push({
          detection: res.detection,
          plate: normalizedPlate,
        });
      }
    }

    // Trigger post-commit side-effects
    setImmediate(async () => {
      for (const eff of sideEffects) {
        await publish('cityai.detections', eff.detection);
        if (eff.plate) {
          liveWs.broadcastLiveDetection(eff.plate, eff.detection);
        }
      }
    });

    return { detections, statuses };
  });
}

async function findCandidates(sourceId, minSpeedKmh = 5.0, maxSpeedKmh = 100.0, maxTimeWindowSec = 7200.0, feasibleOnly = false) {
  const result = await detectionRepo.findCandidates(sourceId, maxTimeWindowSec);
  if (!result) {
    const err = new Error(`Detection not found with id: ${sourceId}`);
    err.status = 404;
    throw err;
  }

  const { source, candidates } = result;
  const srcVec = parseEmbedding(source.reid_embedding);
  const srcTime = new Date(source.timestamp).getTime();
  const isValidCoordinate = (value, min, max) => {
    if (value == null || value === '') return false;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= min && numeric <= max;
  };
  const sourceHasCoordinates =
    isValidCoordinate(source.latitude, -90, 90) &&
    isValidCoordinate(source.longitude, -180, 180);

  const evaluated = [];
  let excludedUnknownCoordinates = 0;
  let excludedUnknownTime = 0;

  for (const cand of candidates) {
    const candidateHasCoordinates =
      isValidCoordinate(cand.latitude, -90, 90) &&
      isValidCoordinate(cand.longitude, -180, 180);
    if (!sourceHasCoordinates || !candidateHasCoordinates) {
      excludedUnknownCoordinates++;
      continue;
    }

    const candVec = parseEmbedding(cand.reidEmbedding);
    const candTime = new Date(cand.timestamp).getTime();
    const elapsedMs = Math.abs(candTime - srcTime);
    const durationSec = Number.isFinite(elapsedMs) && elapsedMs > 0
      ? elapsedMs / 1000.0
      : null;
    const distKm = haversineDistanceKm(
      Number(source.latitude),
      Number(source.longitude),
      Number(cand.latitude),
      Number(cand.longitude)
    );
    const speedKmh = durationSec === null
      ? null
      : calculateSpeedKmh(distKm, durationSec);

    const reidSim = cosineSimilarity(srcVec, candVec);
    const speedFeasible = speedKmh === null
      ? null
      : speedKmh >= minSpeedKmh && speedKmh <= maxSpeedKmh;

    if (speedFeasible === null) excludedUnknownTime++;
    if (feasibleOnly && speedFeasible !== true) {
      continue;
    }

    evaluated.push({
      detectionId: cand.id,
      cameraId: cand.cameraId,
      cameraName: cand.cameraName,
      timestamp: cand.timestamp,
      vehicleType: cand.vehicleType,
      color: cand.vehicleColor,
      reidSimilarity: Math.round(reidSim * 100) / 100,
      distanceKm: Math.round(distKm * 100) / 100,
      durationMinutes: durationSec === null ? null : Math.round((durationSec / 60.0) * 10) / 10,
      impliedSpeedKmh: speedKmh === null ? null : Math.round(speedKmh * 10) / 10,
      isFeasible: speedFeasible,
    });
  }

  return {
    sourceDetectionId: source.id,
    sourceCameraId: source.camera_id,
    sourceTimestamp: source.timestamp,
    candidates: evaluated,
    totalEvaluated: evaluated.length,
    excludedUnknownCoordinates,
    excludedUnknownTime,
  };
}

module.exports = {
  ingestBatch,
  findCandidates,
};
