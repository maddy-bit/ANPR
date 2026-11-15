/**
 * Global Identity & Multi-Signal Association Repository
 *
 * Column names align with migrations V6__global_vehicle_identities.sql:
 *   global_identities(vehicle_class, color, ...) and
 *   identity_associations(reid_score, plate_score, overall_score, decision, review_status, ...).
 * API-facing aliases (primaryVehicleType, primaryColor, status, reidSimilarity,
 * plateSimilarity, compositeScore, evaluatedAt) are preserved for contract stability.
 */

const { query } = require('../../database/pool');

const IDENTITY_LIST_COLUMNS = `
  id, label, primary_plate AS "primaryPlate",
  vehicle_class AS "primaryVehicleType",
  color AS "primaryColor", created_at AS "createdAt"
`;

const ASSOCIATION_COLUMNS = `
  id, source_detection_id AS "sourceDetectionId",
  candidate_detection_id AS "candidateDetectionId",
  global_identity_id AS "globalIdentityId",
  decision AS "status", review_status AS "reviewStatus",
  reid_score AS "reidSimilarity",
  plate_score AS "plateSimilarity",
  overall_score AS "compositeScore",
  decision_reason AS "decisionReason",
  created_at AS "evaluatedAt"
`;

async function findAll({ page = 0, size = 20 } = {}) {
  const countRes = await query('SELECT COUNT(*) AS total FROM global_identities');
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = page * size;
  const sql = `
    SELECT ${IDENTITY_LIST_COLUMNS}
    FROM global_identities
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;
  const res = await query(sql, [size, offset]);
  return {
    content: res.rows,
    totalElements: total,
    totalPages: Math.ceil(total / size),
    number: page,
    size,
  };
}

async function findById(id) {
  const sql = `
    SELECT ${IDENTITY_LIST_COLUMNS}
    FROM global_identities
    WHERE id = $1
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
}

async function findByLabel(label) {
  const sql = `
    SELECT ${IDENTITY_LIST_COLUMNS}
    FROM global_identities
    WHERE label = $1
  `;
  const res = await query(sql, [label]);
  return res.rows[0] || null;
}

async function search(searchQuery) {
  const sql = `
    SELECT ${IDENTITY_LIST_COLUMNS}
    FROM global_identities
    WHERE id::text ILIKE $1
       OR label ILIKE $1
       OR primary_plate ILIKE $1
    LIMIT 1
  `;
  const res = await query(sql, [`%${searchQuery}%`]);
  return res.rows[0] || null;
}

/**
 * Creates a persistent global identity row. Requires firstSeenTimestamp and
 * lastSeenTimestamp (NOT NULL columns in V6).
 */
async function createGlobalIdentity(data) {
  const sql = `
    INSERT INTO global_identities (
      label, primary_plate, plate_confidence, vehicle_class, color,
      first_seen_timestamp, last_seen_timestamp, detection_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING ${IDENTITY_LIST_COLUMNS}
  `;
  const params = [
    data.label,
    data.primaryPlate || null,
    data.plateConfidence || null,
    data.primaryVehicleType || null,
    data.primaryColor || null,
    data.firstSeenTimestamp,
    data.lastSeenTimestamp,
    data.detectionCount || 1,
  ];
  const res = await query(sql, params);
  return res.rows[0];
}

async function linkDetectionToIdentity(detectionId, identityId) {
  const sql = `
    UPDATE vehicle_detections SET global_identity_id = $2
    WHERE id = $1
  `;
  await query(sql, [detectionId, identityId]);
}

async function findDetectionsByIdentity(identityId, { page = 0, size = 20 } = {}) {
  const countSql = 'SELECT COUNT(*) AS total FROM vehicle_detections WHERE global_identity_id = $1';
  const countRes = await query(countSql, [identityId]);
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = page * size;
  const sql = `
    SELECT d.id, d.camera_id AS "cameraId", c.name AS "cameraName",
           c.latitude, c.longitude, d.timestamp,
           d.detection_confidence AS "confidence",
           d.plate_text_normalized AS "plateText",
           d.plate_confidence AS "plateConfidence",
           d.vehicle_class AS "vehicleType",
           v.color AS "vehicleColor",
           d.bbox,
           d.image_path AS "evidencePath",
           d.reid_embedding AS "reidEmbedding"
    FROM vehicle_detections d
    LEFT JOIN vehicles v ON d.vehicle_id = v.id
    LEFT JOIN cameras c ON d.camera_id = c.id
    WHERE d.global_identity_id = $1
    ORDER BY d.timestamp ASC
    LIMIT $2 OFFSET $3
  `;
  const res = await query(sql, [identityId, size, offset]);
  return {
    content: res.rows,
    totalElements: total,
    totalPages: Math.ceil(total / size),
    number: page,
    size,
  };
}

async function findAssociationsByIdentity(identityId, { page = 0, size = 20 } = {}) {
  const countSql = 'SELECT COUNT(*) AS total FROM identity_associations WHERE global_identity_id = $1';
  const countRes = await query(countSql, [identityId]);
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = page * size;
  const sql = `
    SELECT ${ASSOCIATION_COLUMNS}
    FROM identity_associations
    WHERE global_identity_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const res = await query(sql, [identityId, size, offset]);
  return {
    content: res.rows,
    totalElements: total,
    totalPages: Math.ceil(total / size),
    number: page,
    size,
  };
}

async function findExistingAssociation(sourceId, candidateId) {
  const sql = `
    SELECT ${ASSOCIATION_COLUMNS}
    FROM identity_associations
    WHERE source_detection_id = $1 AND candidate_detection_id = $2
  `;
  const res = await query(sql, [sourceId, candidateId]);
  return res.rows[0] || null;
}

async function createAssociation(data) {
  const sql = `
    INSERT INTO identity_associations (
      id, source_detection_id, candidate_detection_id, global_identity_id,
      decision, decision_reason, reid_score, plate_score, overall_score
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING ${ASSOCIATION_COLUMNS}
  `;
  const params = [
    data.id,
    data.sourceDetectionId,
    data.candidateDetectionId,
    data.globalIdentityId,
    data.decision,
    data.decisionReason,
    data.reidSimilarity,
    data.plateSimilarity,
    data.compositeScore,
  ];
  const res = await query(sql, params);
  return res.rows[0];
}

/**
 * Human review of an association. Updates both the system decision and the
 * review status, keeping provenance of the original evaluation.
 */
async function reviewAssociation(id, { decision, reviewStatus, reviewNotes }) {
  const sql = `
    UPDATE identity_associations
    SET decision = $2, review_status = $3, review_notes = COALESCE($4, review_notes), updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING ${ASSOCIATION_COLUMNS}
  `;
  const res = await query(sql, [id, decision, reviewStatus, reviewNotes || null]);
  return res.rows[0] || null;
}

async function findCameraEdge(fromCamId, toCamId) {
  const sql = `
    SELECT id, from_camera_id, to_camera_id, road_distance_meters,
           min_travel_time_sec, max_travel_time_sec, is_verified
    FROM camera_edges
    WHERE from_camera_id = $1 AND to_camera_id = $2
  `;
  const res = await query(sql, [fromCamId, toCamId]);
  return res.rows[0] || null;
}

module.exports = {
  findAll,
  findById,
  findByLabel,
  search,
  createGlobalIdentity,
  linkDetectionToIdentity,
  findDetectionsByIdentity,
  findAssociationsByIdentity,
  findExistingAssociation,
  createAssociation,
  reviewAssociation,
  findCameraEdge,
};
