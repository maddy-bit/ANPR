/**
 * Vehicle & Vehicle Detections Repository
 */

const { query } = require('../../database/pool');

async function findTop10Recent() {
  const sql = `
    SELECT id, plate, vehicle_type AS "vehicleType", color, make, model
    FROM vehicles
    ORDER BY id DESC
    LIMIT 10
  `;
  const res = await query(sql);
  return res.rows;
}

async function findByPlate(plate) {
  const sql = `
    SELECT id, plate, vehicle_type AS "vehicleType", color, make, model
    FROM vehicles
    WHERE plate = $1
  `;
  const res = await query(sql, [plate]);
  return res.rows[0] || null;
}

async function upsert(vehicle, client) {
  const runner = client || { query };
  const sql = `
    INSERT INTO vehicles (plate, vehicle_type, color, make, model)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (plate) DO UPDATE SET
      vehicle_type = COALESCE(EXCLUDED.vehicle_type, vehicles.vehicle_type),
      color = COALESCE(EXCLUDED.color, vehicles.color),
      make = COALESCE(EXCLUDED.make, vehicles.make),
      model = COALESCE(EXCLUDED.model, vehicles.model)
    RETURNING id, plate, vehicle_type AS "vehicleType", color, make, model
  `;
  const params = [
    vehicle.plate,
    vehicle.vehicleType || null,
    vehicle.color || null,
    vehicle.make || null,
    vehicle.model || null,
  ];
  const res = await runner.query(sql, params);
  return res.rows[0];
}

async function findDetectionsByPlate(plate) {
  const sql = `
    SELECT 
      d.id,
      d.camera_id AS "cameraId",
      c.name AS "cameraName",
      c.latitude,
      c.longitude,
      d.timestamp,
      d.detection_confidence AS "confidence",
      d.plate_text_normalized AS "plateText",
      d.plate_confidence AS "plateConfidence",
      d.vehicle_class AS "vehicleType",
      v.color AS "vehicleColor",
      d.bbox,
      d.image_path AS "evidencePath",
      d.track_id AS "trackId",
      d.reid_embedding AS "reidEmbedding",
      d.video_upload_id AS "videoUploadId",
      d.processing_run_id AS "processingRunId",
      d.idempotency_key AS "idempotencyKey"
    FROM vehicle_detections d
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    LEFT JOIN cameras c ON d.camera_id = c.id
    WHERE d.plate_text_normalized = $1 OR (v.plate = $1)
    ORDER BY d.timestamp ASC
  `;
  const res = await query(sql, [plate]);
  return res.rows;
}

module.exports = {
  findTop10Recent,
  findByPlate,
  upsert,
  findDetectionsByPlate,
};
