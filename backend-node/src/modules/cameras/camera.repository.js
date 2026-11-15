const { query } = require('../../database/pool');

const CAMERA_FIELDS = [
  'c.id', 'c.name', 'c.latitude', 'c.longitude', 'c.direction', 'c.status',
  'c.video_source AS "videoSource"', 'c.source_type AS "sourceType"', 'c.source_network AS "sourceNetwork"',
  'c.source_name AS "sourceName"', 'c.source_camera_id AS "sourceCameraId"',
  'c.feed_type AS "feedType"',
  "CASE WHEN c.source_type = 'GOVERNMENT_API' THEN NULL ELSE c.stream_url END AS \"streamUrl\"",
  "CASE WHEN c.source_type = 'GOVERNMENT_API' THEN NULL ELSE c.archive_url END AS \"archiveUrl\"",
  'c.page_url AS "pageUrl"',
  'c.attribution', 'c.country_code AS "countryCode"', 'c.region', 'c.place',
  'c.live_video AS "liveVideo"', 'c.live_snapshot AS "liveSnapshot"',
  'c.archive_available AS "archiveAvailable"', 'c.external_player AS "externalPlayer"',
  'c.source_status AS "sourceStatus"', 'c.source_last_seen_at AS "sourceLastSeenAt"',
].join(', ');

function modeClause(mode) {
  if (mode === 'live') return "WHERE (c.live_video OR c.live_snapshot OR c.external_player) AND COALESCE(c.source_status, 'UNKNOWN') NOT IN ('DOWN','OFFLINE','UNAVAILABLE','STALE')";
  if (mode === 'historic') return 'WHERE (c.archive_available OR EXISTS (SELECT 1 FROM vehicle_detections d WHERE d.camera_id = c.id) OR EXISTS (SELECT 1 FROM video_uploads u WHERE u.camera_id = c.id))';
  if (mode === 'hybrid') return "WHERE ((c.live_video OR c.live_snapshot OR c.external_player) AND COALESCE(c.source_status, 'UNKNOWN') NOT IN ('DOWN','OFFLINE','UNAVAILABLE','STALE') OR c.archive_available OR EXISTS (SELECT 1 FROM vehicle_detections d WHERE d.camera_id = c.id) OR EXISTS (SELECT 1 FROM video_uploads u WHERE u.camera_id = c.id))";
  return '';
}

async function findAll(mode) {
  const clause = modeClause(mode || 'all');
  const result = await query('SELECT ' + CAMERA_FIELDS + ' FROM cameras c ' + clause + ' ORDER BY c.id ASC');
  return result.rows;
}

async function findWithinBounds(mode, bounds) {
  const clause = modeClause(mode || 'all');
  const conjunction = clause ? ' AND ' : ' WHERE ';
  const result = await query(
    'SELECT ' + CAMERA_FIELDS + ' FROM cameras c ' + clause + conjunction +
    'c.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography ' +
    'ORDER BY c.id ASC',
    [bounds.west, bounds.south, bounds.east, bounds.north]
  );
  return result.rows;
}

async function findById(id) {
  const result = await query('SELECT ' + CAMERA_FIELDS + ' FROM cameras c WHERE c.id = $1', [id]);
  return result.rows[0] || null;
}

async function create(camera) {
  const sql = 'INSERT INTO cameras (id, name, latitude, longitude, direction, status, video_source) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7) ' +
    'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, latitude = EXCLUDED.latitude, ' +
    'longitude = EXCLUDED.longitude, direction = EXCLUDED.direction, status = EXCLUDED.status, ' +
    'video_source = EXCLUDED.video_source ' +
    'RETURNING id, name, latitude, longitude, direction, status, video_source AS "videoSource"';
  const params = [
    camera.id, camera.name || ('Camera ' + camera.id),
    camera.latitude, camera.longitude, camera.direction || null,
    camera.status || 'CONFIGURED', camera.videoSource || null,
  ];
  const result = await query(sql, params);
  return result.rows[0];
}

async function findNearby(latitude, longitude, radiusKm) {
  const radiusMeters = radiusKm * 1000.0;
  const result = await query(
    'SELECT ' + CAMERA_FIELDS + ', ST_Distance(c.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters" ' +
    'FROM cameras c WHERE ST_DWithin(c.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) ' +
    'ORDER BY c.location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography',
    [longitude, latitude, radiusMeters]
  );
  return result.rows;
}

async function count() {
  const result = await query('SELECT COUNT(*) AS total FROM cameras');
  return parseInt(result.rows[0].total, 10);
}

module.exports = { findAll, findWithinBounds, findById, create, findNearby, count };
