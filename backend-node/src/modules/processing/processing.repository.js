/**
 * Processing Run Repository
 */

const { query } = require('../../database/pool');

async function createRun(data, client = null) {
  const sql = `
    INSERT INTO video_processing_runs (
      id, video_upload_id, run_number, generation, client_run_token, status,
      frame_stride, enable_dehaze, config_hash, config_status, started_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, video_upload_id AS "videoUploadId", run_number AS "runNumber",
              generation, client_run_token AS "clientRunToken", status,
              frame_stride AS "frameStride", enable_dehaze AS "enableDehaze",
              config_hash AS "configHash", config_status AS "configStatus",
              started_at AS "startedAt"
  `;
  const now = new Date();
  const runNum = data.runNumber || data.generation || 1;
  const configStatus = data.configStatus || 'ACTIVE';
  const configHash = data.configHash || 'default:config';

  const params = [
    data.id,
    data.videoUploadId,
    runNum,
    data.generation || runNum,
    data.clientRunToken || null,
    data.status || 'QUEUED',
    data.frameStride || 5,
    data.enableDehaze || false,
    configHash,
    configStatus,
    data.startedAt || now,
    now,
    now,
  ];
  // `query` is a callable wrapper; a transaction `client` is a pg PoolClient,
  // which only exposes .query(sql, params) — never direct call syntax.
  const res = client ? await client.query(sql, params) : await query(sql, params);
  return res.rows[0];
}

async function findByUploadId(uploadId) {
  const sql = `
    SELECT id, video_upload_id AS "videoUploadId", run_number AS "runNumber", generation,
           client_run_token AS "clientRunToken", status,
           frame_stride AS "frameStride", enable_dehaze AS "enableDehaze",
           config_hash AS "configHash", config_status AS "configStatus",
           started_at AS "startedAt", completed_at AS "completedAt",
           frames_processed AS "framesProcessed", detections_count AS "detectionsCount",
           failure_reason AS "errorMessage", failure_reason AS "failureReason",
           manifest_path AS "manifestPath", manifest_sha256 AS "manifestSha256"
    FROM video_processing_runs
    WHERE video_upload_id = $1
    ORDER BY generation DESC
  `;
  const res = await query(sql, [uploadId]);
  return res.rows;
}

async function findById(uploadId, runId) {
  const sql = `
    SELECT id, video_upload_id AS "videoUploadId", run_number AS "runNumber", generation,
           client_run_token AS "clientRunToken", status,
           frame_stride AS "frameStride", enable_dehaze AS "enableDehaze",
           config_hash AS "configHash", config_status AS "configStatus",
           started_at AS "startedAt", completed_at AS "completedAt",
           frames_processed AS "framesProcessed", detections_count AS "detectionsCount",
           failure_reason AS "errorMessage", failure_reason AS "failureReason",
           manifest_path AS "manifestPath", manifest_sha256 AS "manifestSha256"
    FROM video_processing_runs
    WHERE video_upload_id = $1 AND id = $2
  `;
  const res = await query(sql, [uploadId, runId]);
  return res.rows[0] || null;
}

async function findByToken(uploadId, token) {
  const sql = `
    SELECT id, video_upload_id AS "videoUploadId", run_number AS "runNumber", generation,
           client_run_token AS "clientRunToken", status,
           frame_stride AS "frameStride", enable_dehaze AS "enableDehaze",
           config_hash AS "configHash", config_status AS "configStatus",
           started_at AS "startedAt"
    FROM video_processing_runs
    WHERE video_upload_id = $1 AND client_run_token = $2
  `;
  const res = await query(sql, [uploadId, token]);
  return res.rows[0] || null;
}

async function completeRun(uploadId, runId, stats) {
  const sql = `
    UPDATE video_processing_runs SET
      status = $1,
      completed_at = $2,
      frames_processed = $3,
      detections_count = $4,
      failure_reason = $5,
      manifest_path = $6,
      manifest_sha256 = $7,
      updated_at = $2
    WHERE video_upload_id = $8 AND (id = $9 OR $9::uuid IS NULL)
  `;
  const params = [
    stats.status || 'COMPLETED',
    new Date(),
    stats.framesProcessed || 0,
    stats.detectionsCount || 0,
    stats.errorMessage || stats.failureReason || null,
    stats.manifestPath || null,
    stats.manifestSha256 || null,
    uploadId,
    runId || null,
  ];
  await query(sql, params);
}

module.exports = {
  createRun,
  findByUploadId,
  findById,
  findByToken,
  completeRun,
};
