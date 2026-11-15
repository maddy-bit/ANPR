const { query } = require('../../database/pool');

const SOURCE_COLUMNS = [
  'id', 'source_key AS "sourceKey"', 'name', 'source_type AS "sourceType"',
  'adapter', 'endpoint_url AS "endpointUrl"', 'country_scope AS "countryScope"',
  'attribution', 'enabled', 'auth_type AS "authType"',
  'auth_header_name AS "authHeaderName"', 'auth_query_name AS "authQueryName"',
  'config', 'last_sync_at AS "lastSyncAt"', 'last_sync_status AS "lastSyncStatus"',
  'last_sync_error AS "lastSyncError"', 'imported_count AS "importedCount"',
  'created_at AS "createdAt"', 'updated_at AS "updatedAt"',
].join(', ');

async function listSources() {
  const result = await query(
    'SELECT ' + SOURCE_COLUMNS + ', (auth_secret_ciphertext IS NOT NULL) AS "hasCredentials" FROM camera_sources ORDER BY source_type, name'
  );
  return result.rows;
}

async function findSourceById(id) {
  const result = await query('SELECT * FROM camera_sources WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findSourceByKey(sourceKey) {
  const result = await query('SELECT * FROM camera_sources WHERE source_key = $1', [sourceKey]);
  return result.rows[0] || null;
}

async function createSource(source) {
  const result = await query(
    'INSERT INTO camera_sources (id, source_key, name, source_type, adapter, endpoint_url, country_scope, attribution, enabled, auth_type, auth_secret_ciphertext, auth_header_name, auth_query_name, config) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10,$11,$12,$13::jsonb) RETURNING id',
    [
      source.id, source.sourceKey, source.name, source.sourceType, source.adapter,
      source.endpointUrl, 'IN', source.attribution || null, source.authType || 'NONE',
      source.encryptedSecret || null, source.authHeaderName || null,
      source.authQueryName || null, JSON.stringify(source.config || {}),
    ]
  );
  return result.rows[0];
}

async function setEnabled(id, enabled) {
  const result = await query(
    'UPDATE camera_sources SET enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
    [id, enabled]
  );
  return result.rowCount > 0;
}

async function updateSyncResult(id, result) {
  await query(
    'UPDATE camera_sources SET last_sync_at = NOW(), last_sync_status = $2, last_sync_error = $3, imported_count = $4, updated_at = NOW() WHERE id = $1',
    [id, result.status, result.error || null, result.importedCount || 0]
  );
}

async function listEnabledSources() {
  const result = await query('SELECT * FROM camera_sources WHERE enabled = TRUE ORDER BY source_type, source_key');
  return result.rows;
}

async function markMissingSourceRecordsStale(sourceId, syncStartedAt) {
  const result = await query(
    "UPDATE cameras SET source_status = 'STALE' WHERE source_id = $1 AND source_last_seen_at < $2",
    [sourceId, syncStartedAt]
  );
  return result.rowCount || 0;
}

async function upsertCameraRecords(source, records) {
  const columns = [
    'id', 'name', 'latitude', 'longitude', 'direction', 'status', 'video_source',
    'source_id', 'source_camera_id', 'source_network', 'source_type', 'source_name', 'feed_type',
    'stream_url', 'archive_url', 'page_url', 'attribution', 'country_code', 'region', 'place',
    'live_video', 'live_snapshot', 'archive_available', 'external_player',
    'source_status', 'source_last_seen_at',
  ];
  const chunkSize = 200;
  let insertedOrUpdated = 0;

  for (let offset = 0; offset < records.length; offset += chunkSize) {
    const chunk = records.slice(offset, offset + chunkSize);
    const values = [];
    const placeholders = [];
    chunk.forEach((camera, index) => {
      const base = index * columns.length;
      const cameraId = (source.source_key.toLowerCase() + ':' + camera.sourceCameraId).slice(0, 255);
      const row = [
        cameraId, camera.name, camera.latitude, camera.longitude,
        camera.direction, 'CONFIGURED', null, source.id, camera.sourceCameraId, camera.sourceNetwork,
        source.source_type, source.name, camera.feedType, camera.streamUrl,
        camera.archiveUrl, camera.pageUrl, camera.attribution, camera.countryCode, camera.region,
        camera.place, camera.liveVideo, camera.liveSnapshot, camera.archiveAvailable,
        camera.externalPlayer, camera.sourceStatus, new Date(),
      ];
      values.push(...row);
      placeholders.push('(' + row.map((_, columnIndex) => '$' + (base + columnIndex + 1)).join(',') + ')');
    });

    const updateColumns = columns.slice(1).filter((column) => column !== 'source_id' && column !== 'source_camera_id');
    const updateSql = updateColumns.map((column) => column + ' = EXCLUDED.' + column).join(', ');
    const sql = 'INSERT INTO cameras (' + columns.join(', ') + ') VALUES ' + placeholders.join(', ')
      + ' ON CONFLICT (source_id, source_camera_id) WHERE source_id IS NOT NULL AND source_camera_id IS NOT NULL '
      + 'DO UPDATE SET ' + updateSql;
    const result = await query(sql, values);
    insertedOrUpdated += result.rowCount || 0;
  }
  return insertedOrUpdated;
}

module.exports = {
  listSources,
  findSourceById,
  findSourceByKey,
  createSource,
  setEnabled,
  updateSyncResult,
  listEnabledSources,
  upsertCameraRecords,
  markMissingSourceRecordsStale,
};
