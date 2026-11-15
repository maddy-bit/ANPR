/**
 * Controlled Tool Registry for Natural-Language Vehicle Investigation Agent
 * All tools are strictly parameterized, safe, and read-only.
 * The Agent NEVER executes arbitrary SQL.
 */

const { query } = require('../../database/pool');
const { normalize } = require('../../utils/plate-normalizer');
const { haversineDistanceMeters, computeKinematicSpeedKmh } = require('../../utils/geo-utils');
const vehicleRepo = require('../vehicles/vehicle.repository');
const cameraRepo = require('../cameras/camera.repository');
const processingRepo = require('../processing/processing.repository');

function hasValidCoordinates(latitude, longitude) {
  if (latitude == null || longitude == null ||
      (typeof latitude !== 'number' && typeof latitude !== 'string') ||
      (typeof longitude !== 'number' && typeof longitude !== 'string') ||
      (typeof latitude === 'string' && latitude.trim() === '') ||
      (typeof longitude === 'string' && longitude.trim() === '')) {
    return false;
  }
  return Number.isFinite(Number(latitude)) && Number(latitude) >= -90 && Number(latitude) <= 90 &&
    Number.isFinite(Number(longitude)) && Number(longitude) >= -180 && Number(longitude) <= 180;
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function findDetectionsInCase(caseId, plate) {
  if (!caseId) return vehicleRepo.findDetectionsByPlate(plate);
  const result = await query(
    'SELECT d.id, d.camera_id AS "cameraId", c.name AS "cameraName", c.latitude, c.longitude, ' +
    'd.timestamp, d.detection_confidence AS "confidence", d.plate_text_normalized AS "plateText", ' +
    'd.plate_confidence AS "plateConfidence", d.vehicle_class AS "vehicleType", v.color AS "vehicleColor", ' +
    'd.bbox, d.image_path AS "evidencePath", d.track_id AS "trackId", d.reid_embedding AS "reidEmbedding", ' +
    'd.video_upload_id AS "videoUploadId", d.processing_run_id AS "processingRunId", ' +
    'd.idempotency_key AS "idempotencyKey" ' +
    'FROM investigations i JOIN vehicle_detections d ON d.plate_text_normalized = i.linked_plate ' +
    'LEFT JOIN cameras c ON c.id = d.camera_id LEFT JOIN vehicles v ON v.id = d.vehicle_id ' +
    'WHERE i.id = $1 AND i.linked_plate = $2 ' +
    'AND (i.search_start_at IS NULL OR d.timestamp >= i.search_start_at) ' +
    'AND (i.search_end_at IS NULL OR d.timestamp <= i.search_end_at) ' +
    'AND (i.search_center_lat IS NULL OR i.search_radius_km IS NULL OR ' +
    '(d.location IS NOT NULL AND ST_DWithin(d.location, ' +
    'ST_SetSRID(ST_MakePoint(i.search_center_lon, i.search_center_lat), 4326)::geography, ' +
    'i.search_radius_km * 1000))) ' +
    'ORDER BY d.timestamp ASC, d.id ASC',
    [caseId, plate]
  );
  return result.rows;
}

const tools = {
  /**
   * Search for a vehicle by plate
   */
  async search_vehicle({ plate }) {
    if (!plate) throw new Error('Missing parameter: plate');
    const norm = normalize(plate);
    const vehicle = await vehicleRepo.findByPlate(norm);
    if (!vehicle) {
      return { found: false, plate: norm, message: `No vehicle found with plate ${norm}` };
    }
    return { found: true, vehicle };
  },

  /**
   * Retrieve all sightings and detections for a vehicle plate
   */
  async get_vehicle_sightings({ plate, startTime, endTime, limit = 50, caseId }) {
    if (!plate) throw new Error('Missing parameter: plate');
    const norm = normalize(plate);
    const detections = await findDetectionsInCase(caseId, norm);

    let filtered = detections || [];
    if (startTime) {
      const start = new Date(startTime).getTime();
      filtered = filtered.filter(d => new Date(d.timestamp).getTime() >= start);
    }
    if (endTime) {
      const end = new Date(endTime).getTime();
      filtered = filtered.filter(d => new Date(d.timestamp).getTime() <= end);
    }

    const capped = filtered.slice(0, parseInt(limit, 10) || 50);
    return {
      plate: norm,
      totalSightings: filtered.length,
      returnedCount: capped.length,
      sightings: capped,
    };
  },

  /**
   * Get the most recent sighting/location for a vehicle
   */
  async get_latest_vehicle_location({ plate, caseId }) {
    if (!plate) throw new Error('Missing parameter: plate');
    const norm = normalize(plate);
    const detections = await findDetectionsInCase(caseId, norm);
    if (!detections || detections.length === 0) {
      return { found: false, plate: norm, message: `No sightings recorded for vehicle ${norm}` };
    }

    const latest = detections[detections.length - 1];
    return {
      found: true,
      plate: norm,
      lastSeenAt: latest.timestamp,
      cameraId: latest.cameraId,
      cameraName: latest.cameraName,
      latitude: latest.latitude,
      longitude: latest.longitude,
      confidence: latest.confidence,
      vehicleType: latest.vehicleType,
      isRealtimeObservation: false,
      disclaimer: 'This represents the last recorded historical observation, not live GPS positioning.',
    };
  },

  /**
   * Find registered surveillance cameras near given coordinates using PostGIS
   */
  async find_nearby_cameras({ latitude, longitude, radiusKm = 5.0 }) {
    if (latitude == null || longitude == null) {
      throw new Error('Missing coordinates: latitude and longitude required');
    }
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    const radius = parseFloat(radiusKm) || 5.0;

    const cameras = await cameraRepo.findNearby(lat, lon, radius);
    return {
      searchCenter: { latitude: lat, longitude: lon },
      radiusKm: radius,
      camerasFound: cameras.length,
      cameras,
    };
  },

  /**
   * Reconstruct and validate vehicle trajectory
   */
  async get_vehicle_trajectory({ plate, caseId }) {
    if (!plate) throw new Error('Missing parameter: plate');
    const norm = normalize(plate);
    const detections = await findDetectionsInCase(caseId, norm);

    if (!detections || detections.length === 0) {
      return { found: false, plate: norm, points: [], segments: [] };
    }

    const points = [];
    const segments = [];
    let totalDistanceMeters = 0;

    for (let i = 0; i < detections.length; i++) {
      const d = detections[i];
      points.push({
        detectionId: d.id,
        cameraId: d.cameraId,
        cameraName: d.cameraName,
        latitude: d.latitude,
        longitude: d.longitude,
        timestamp: d.timestamp,
        confidence: d.confidence,
        vehicleType: d.vehicleType,
      });

      if (i > 0) {
        const prev = detections[i - 1];
        const coordinatesAvailable = hasValidCoordinates(prev.latitude, prev.longitude) &&
          hasValidCoordinates(d.latitude, d.longitude);
        const previousTime = parseTimestamp(prev.timestamp);
        const currentTime = parseTimestamp(d.timestamp);
        const dist = coordinatesAvailable
          ? haversineDistanceMeters(Number(prev.latitude), Number(prev.longitude), Number(d.latitude), Number(d.longitude))
          : null;
        const timeDeltaSec = previousTime != null && currentTime != null
          ? (currentTime - previousTime) / 1000.0
          : null;
        const speedKmh = dist != null && timeDeltaSec != null && timeDeltaSec > 0
          ? computeKinematicSpeedKmh(dist, timeDeltaSec)
          : null;
        const feasible = speedKmh == null ? null : speedKmh <= 150; // configured plausibility envelope
        if (dist != null) totalDistanceMeters += dist;

        segments.push({
          fromCamera: prev.cameraId,
          toCamera: d.cameraId,
          distanceMeters: dist == null ? null : Math.round(dist),
          timeDeltaSeconds: timeDeltaSec == null ? null : Math.round(timeDeltaSec),
          speedKmh: speedKmh == null ? null : Math.round(speedKmh * 10) / 10,
          feasible,
        });
      }
    }

    const hasIncompleteDistance = segments.some((segment) => segment.distanceMeters == null);
    const hasUnknownFeasibility = segments.some((segment) => segment.feasible == null);

    return {
      found: true,
      plate: norm,
      totalObservations: points.length,
      totalDistanceKm: hasIncompleteDistance ? null : Math.round((totalDistanceMeters / 1000.0) * 10) / 10,
      points,
      segments,
      overallFeasible: segments.length === 0 || hasUnknownFeasibility
        ? null
        : segments.every((segment) => segment.feasible),
    };
  },

  /**
   * Compare two vehicle sightings
   */
  async compare_vehicle_sightings({ detectionId1, detectionId2 }) {
    if (!detectionId1 || !detectionId2) {
      throw new Error('Both detectionId1 and detectionId2 are required');
    }

    const res = await query(
      `SELECT d.*, c.name AS camera_name FROM vehicle_detections d JOIN cameras c ON d.camera_id = c.id WHERE d.id IN ($1, $2)`,
      [detectionId1, detectionId2]
    );

    if (res.rows.length < 2) {
      return { error: 'One or both detections could not be found' };
    }

    const [d1, d2] = res.rows;
    const samePlate = d1.plate_text_normalized && d2.plate_text_normalized &&
                      d1.plate_text_normalized === d2.plate_text_normalized;
    const coordinatesAvailable = hasValidCoordinates(d1.latitude, d1.longitude) &&
      hasValidCoordinates(d2.latitude, d2.longitude);
    const distMeters = coordinatesAvailable
      ? haversineDistanceMeters(Number(d1.latitude), Number(d1.longitude), Number(d2.latitude), Number(d2.longitude))
      : null;
    const time1 = parseTimestamp(d1.timestamp);
    const time2 = parseTimestamp(d2.timestamp);
    const timeDeltaSec = time1 != null && time2 != null
      ? Math.abs(time2 - time1) / 1000.0
      : null;
    const speedKmh = distMeters != null && timeDeltaSec != null && timeDeltaSec > 0
      ? computeKinematicSpeedKmh(distMeters, timeDeltaSec)
      : null;

    return {
      detection1: { id: d1.id, plate: d1.plate_text_normalized, camera: d1.camera_id, timestamp: d1.timestamp },
      detection2: { id: d2.id, plate: d2.plate_text_normalized, camera: d2.camera_id, timestamp: d2.timestamp },
      plateMatch: Boolean(samePlate),
      identityStatus: 'CANDIDATE_UNVERIFIED',
      identityDisclaimer: 'Equal normalized OCR text is a candidate association, not a confirmed vehicle identity.',
      spatialDistanceMeters: distMeters == null ? null : Math.round(distMeters),
      timeDeltaSeconds: timeDeltaSec == null ? null : Math.round(timeDeltaSec),
      speedKmh: speedKmh == null ? null : Math.round(speedKmh * 10) / 10,
      kinematicallyFeasible: speedKmh == null ? null : speedKmh <= 150,
      overallMatchConfidence: null,
    };
  },

  /**
   * Get processing status for a video upload run
   */
  async get_processing_status({ videoUploadId, runId } = {}) {
    if (!videoUploadId) {
      const res = await query(`
        SELECT r.id, r.video_upload_id AS "videoUploadId", r.status,
               r.frames_processed AS "framesProcessed", r.detections_count AS "detectionsCount",
               r.started_at AS "startedAt", r.completed_at AS "completedAt",
               r.failure_reason AS "errorMessage"
        FROM video_processing_runs r
        ORDER BY r.started_at DESC
        LIMIT 1
      `);
      if (res.rows.length === 0) {
        return { found: false, message: 'No video processing jobs found' };
      }
      return {
        found: true,
        videoUploadId: res.rows[0].videoUploadId,
        run: res.rows[0],
        allRunsCount: 1,
      };
    }
    const runs = await processingRepo.findByUploadId(videoUploadId);
    if (!runs || runs.length === 0) {
      return { found: false, message: 'No processing runs found for this video upload' };
    }
    const targetRun = runId ? runs.find(r => r.id === runId) : runs[0];
    return {
      found: true,
      videoUploadId,
      run: targetRun || runs[0],
      allRunsCount: runs.length,
    };
  },

  /**
   * Provide comprehensive investigation summary for a vehicle
   */
  async get_investigation_summary({ plate, caseId }) {
    if (!plate) throw new Error('Missing parameter: plate');
    const norm = normalize(plate);
    const [vehicle, detections] = await Promise.all([
      vehicleRepo.findByPlate(norm),
      findDetectionsInCase(caseId, norm),
    ]);

    if (!detections || detections.length === 0) {
      return { found: false, plate: norm, message: `No investigation records found for ${norm}` };
    }

    const cameras = [...new Set(detections.map(d => d.cameraName || d.cameraId))];
    const firstSeen = detections[0].timestamp;
    const lastSeen = detections[detections.length - 1].timestamp;

    return {
      found: true,
      plate: norm,
      vehicle: vehicle || { plate: norm, vehicleType: detections[0].vehicleType },
      sightingsCount: detections.length,
      camerasVisited: cameras,
      firstObservation: firstSeen,
      latestObservation: lastSeen,
      latestLocation: {
        cameraId: detections[detections.length - 1].cameraId,
        cameraName: detections[detections.length - 1].cameraName,
        latitude: detections[detections.length - 1].latitude,
        longitude: detections[detections.length - 1].longitude,
      },
    };
  },
};

module.exports = {
  tools,
  getToolNames: () => Object.keys(tools),
  executeTool: async (name, params) => {
    if (!tools[name]) {
      throw new Error(`Tool not registered: ${name}`);
    }
    return await tools[name](params);
  },
};
