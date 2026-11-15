/**
 * Video Upload Repository
 */

const { query } = require('../../database/pool');

async function create(data) {
  const sql = `
    INSERT INTO video_uploads (
      id, original_filename, file_size, mime_type, storage_key, storage_provider, storage_bucket,
      status, created_at, updated_at, camera_id, active_run_generation
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, original_filename AS "originalFilename", file_size AS "fileSize",
              mime_type AS "mimeType", storage_key AS "storagePath", storage_key AS "storageKey",
              storage_provider AS "storageProvider", storage_bucket AS "storageBucket",
              status, created_at AS "uploadedAt", created_at AS "createdAt", camera_id AS "cameraId",
              active_run_generation AS "activeRunGeneration"
  `;
  const now = new Date();
  const params = [
    data.id,
    data.originalFilename,
    data.fileSize,
    data.mimeType,
    data.storagePath || data.storageKey,
    data.storageProvider || 'LOCAL',
    data.storageBucket || null,
    data.status || 'UPLOADED',
    data.uploadedAt || data.createdAt || now,
    now,
    data.cameraId || null,
    data.activeRunGeneration || 0,
  ];
  const res = await query(sql, params);
  return res.rows[0];
}

async function findById(id) {
  const sql = `
    SELECT id, original_filename AS "originalFilename", file_size AS "fileSize",
           mime_type AS "mimeType", storage_key AS "storagePath", storage_key AS "storageKey",
           storage_provider AS "storageProvider", storage_bucket AS "storageBucket",
           status, created_at AS "uploadedAt", created_at AS "createdAt",
           camera_id AS "cameraId", active_run_generation AS "activeRunGeneration"
    FROM video_uploads
    WHERE id = $1
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
}

async function findAll({ page = 0, size = 10, status, cameraId } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (cameraId) {
    params.push(cameraId);
    conditions.push(`camera_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*) AS total FROM video_uploads ${whereClause}`;
  const countRes = await query(countSql, params);
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = page * size;
  params.push(size);
  params.push(offset);

  const sql = `
    SELECT id, original_filename AS "originalFilename", file_size AS "fileSize",
           mime_type AS "mimeType", storage_key AS "storagePath", storage_key AS "storageKey",
           storage_provider AS "storageProvider", storage_bucket AS "storageBucket",
           status, created_at AS "uploadedAt", created_at AS "createdAt",
           camera_id AS "cameraId", active_run_generation AS "activeRunGeneration"
    FROM video_uploads
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const res = await query(sql, params);

  return {
    content: res.rows,
    totalElements: total,
    totalPages: Math.ceil(total / size),
    number: page,
    size,
  };
}

async function updateStatus(id, status, activeGeneration = null, client = null) {
  let sql = 'UPDATE video_uploads SET status = $1';
  const params = [status, id];
  if (activeGeneration !== null) {
    sql += ', active_run_generation = $3 WHERE id = $2';
    params.push(activeGeneration);
  } else {
    sql += ' WHERE id = $2';
  }
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}

async function remove(id) {
  const sql = 'DELETE FROM video_uploads WHERE id = $1';
  await query(sql, [id]);
}

async function findDetectionsByUploadId(uploadId, { page = 0, size = 20 } = {}) {
  const countSql = 'SELECT COUNT(*) AS total FROM vehicle_detections WHERE video_upload_id = $1';
  const countRes = await query(countSql, [uploadId]);
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = page * size;
  const sql = `
    SELECT d.id, d.camera_id AS "cameraId", d.timestamp,
           d.detection_confidence AS "confidence",
           d.plate_text_normalized AS "plateText",
           d.plate_confidence AS "plateConfidence",
           d.vehicle_class AS "vehicleType",
           d.image_path AS "evidencePath",
           d.track_id AS "trackId",
           d.bbox,
           d.idempotency_key AS "idempotencyKey"
    FROM vehicle_detections d
    WHERE d.video_upload_id = $1
    ORDER BY d.timestamp ASC
    LIMIT $2 OFFSET $3
  `;
  const res = await query(sql, [uploadId, size, offset]);
  return {
    content: res.rows,
    totalElements: total,
    totalPages: Math.ceil(total / size),
    number: page,
    size,
  };
}

module.exports = {
  create,
  findById,
  findAll,
  updateStatus,
  remove,
  findDetectionsByUploadId,
};
