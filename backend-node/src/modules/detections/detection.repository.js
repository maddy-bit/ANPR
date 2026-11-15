/**
 * Detection Repository
 * Handles detection upsert with idempotency keys and multi-signal candidate evaluation.
 */

const { query } = require('../../database/pool');

async function insertDetection(data, client) {
  const runner = client || { query };

  // Resolve camera coordinates if not provided
  let lat = data.latitude;
  let lon = data.longitude;
  if (lat == null || lon == null) {
    // Let database connectivity/schema errors propagate; do not disguise them as missing coordinates.
    const camRes = await runner.query(
      'SELECT latitude, longitude FROM cameras WHERE id = $1',
      [data.cameraId]
    );
    if (camRes.rows.length > 0) {
      lat = camRes.rows[0].latitude;
      lon = camRes.rows[0].longitude;
    }
  }
  if (lat == null || lon == null) {
    const err = new Error(`Valid camera coordinates are required for detection ingestion (camera: ${data.cameraId}).`);
    err.status = 422;
    throw err;
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) ||
      Number(lat) < -90 || Number(lat) > 90 || Number(lon) < -180 || Number(lon) > 180) {
    const err = new Error('Detection latitude/longitude are outside valid geographic bounds.');
    err.status = 422;
    throw err;
  }

  const rawConfidence = data.confidence ?? data.detectionConfidence;
  const confidence = Number(rawConfidence);
  if (rawConfidence == null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    const err = new Error('Detection confidence must be a finite number between 0 and 1.');
    err.status = 422;
    throw err;
  }
  const timestamp = data.timestamp == null || data.timestamp === '' ? null : new Date(data.timestamp);
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    const err = new Error('A valid detection timestamp is required.');
    err.status = 422;
    throw err;
  }

  let bboxStr = null;
  if (typeof data.bbox === 'string') {
    bboxStr = data.bbox;
  } else if (data.bboxX1 != null && data.bboxY1 != null) {
    bboxStr = `${data.bboxX1},${data.bboxY1},${data.bboxX2 ?? 0},${data.bboxY2 ?? 0}`;
  } else if (Array.isArray(data.bbox)) {
    bboxStr = data.bbox.join(',');
  } else if (data.bbox && typeof data.bbox === 'object') {
    const { x1, y1, x2, y2 } = data.bbox;
    if ([x1, y1, x2, y2].every(value => value != null && Number.isFinite(Number(value)))) {
      bboxStr = [x1, y1, x2, y2].map(Number).join(',');
    }
  }

  const sql = `
    INSERT INTO vehicle_detections (
      camera_id, vehicle_id, timestamp, latitude, longitude,
      direction, speed_kmh, vehicle_class, detection_confidence,
      plate_confidence, plate_text_raw, plate_text_normalized,
      reid_confidence, reid_embedding, reid_model_name, reid_model_version, reid_dimension,
      image_path, track_id, frame_number, video_upload_id, processing_run_id, idempotency_key,
      global_identity_id, bbox
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22, $23,
      $24, $25
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id, camera_id AS "cameraId", vehicle_id AS "vehicleId", timestamp,
              latitude, longitude, direction, speed_kmh AS "speedKmh",
              vehicle_class AS "vehicleClass", vehicle_class AS "vehicleType",
              detection_confidence AS "confidence", plate_text_normalized AS "plateText",
              plate_confidence AS "plateConfidence", image_path AS "evidencePath",
              track_id AS "trackId", idempotency_key AS "idempotencyKey",
              reid_embedding AS "reidEmbedding", reid_model_name AS "reidModelName",
              reid_model_version AS "reidModelVersion", reid_dimension AS "reidDimension"
  `;

  const params = [
    data.cameraId,
    data.vehicleId || null,
    timestamp,
    Number(lat),
    Number(lon),
    data.direction || null,
    data.speedKmh ?? null,
    data.vehicleType || data.vehicleClass || null,
    confidence,
    data.plateConfidence ?? null,
    data.plateTextRaw || data.plateText || null,
    data.plateText || data.plateTextNormalized || null,
    data.reidConfidence ?? null,
    data.reidEmbedding || null,
    data.reidModelName || null,
    data.reidModelVersion || null,
    data.reidDimension ?? null,
    data.evidencePath || data.imagePath || null,
    data.trackId ?? null,
    data.frameNumber ?? null,
    data.videoUploadId || null,
    data.processingRunId || null,
    data.idempotencyKey || null,
    data.globalIdentityId || null,
    bboxStr,
  ];

  const res = await runner.query(sql, params);
  if (res.rows.length === 0) {
    // Conflict occurred: fetch existing detection
    const existing = await runner.query(
      `SELECT id, camera_id AS "cameraId", vehicle_id AS "vehicleId", timestamp,
              latitude, longitude, direction, speed_kmh AS "speedKmh",
              vehicle_class AS "vehicleClass", vehicle_class AS "vehicleType",
              detection_confidence AS "confidence", plate_text_normalized AS "plateText",
              plate_confidence AS "plateConfidence", image_path AS "evidencePath",
              track_id AS "trackId", idempotency_key AS "idempotencyKey",
              reid_embedding AS "reidEmbedding", reid_model_name AS "reidModelName",
              reid_model_version AS "reidModelVersion", reid_dimension AS "reidDimension"
       FROM vehicle_detections WHERE idempotency_key = $1`,
      [data.idempotencyKey]
    );
    return { detection: existing.rows[0], status: 'DUPLICATE' };
  }
  return { detection: res.rows[0], status: 'CREATED' };
}

async function findById(id) {
  const sql = `
    SELECT d.*, c.latitude, c.longitude, c.name AS camera_name,
           v.color AS vehicle_color
    FROM vehicle_detections d
    JOIN cameras c ON d.camera_id = c.id
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.id = $1
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
}

async function findCandidates(sourceDetectionId, windowSeconds = 7200) {
  const source = await findById(sourceDetectionId);
  if (!source) return null;

  const srcTime = new Date(source.timestamp);
  const minTime = new Date(srcTime.getTime() - windowSeconds * 1000);
  const maxTime = new Date(srcTime.getTime() + windowSeconds * 1000);

  const sql = `
    SELECT d.id, d.camera_id AS "cameraId", c.name AS "cameraName",
           c.latitude, c.longitude, d.timestamp,
           d.detection_confidence AS "confidence",
           d.plate_text_normalized AS "plateText", d.plate_confidence AS "plateConfidence",
           d.vehicle_class AS "vehicleType", v.color AS "vehicleColor",
           d.image_path AS "evidencePath", d.reid_embedding AS "reidEmbedding"
    FROM vehicle_detections d
    JOIN cameras c ON d.camera_id = c.id
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    WHERE d.timestamp BETWEEN $1 AND $2
      AND d.camera_id != $3
    ORDER BY d.timestamp ASC
  `;
  const res = await query(sql, [minTime, maxTime, source.camera_id]);
  return { source, candidates: res.rows };
}

module.exports = {
  insertDetection,
  findById,
  findCandidates,
};
