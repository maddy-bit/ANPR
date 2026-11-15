/**
 * Transactional Outbox & Resilient AI Dispatch Worker
 * Handles durable background dispatch, automatic exponential retry,
 * and startup recovery for queued video processing jobs.
 */

const path = require('path');
const axios = require('axios');
const config = require('../../config/env');
const logger = require('../../config/logger');
const { query } = require('../../database/pool');
const processingRepo = require('./processing.repository');
const uploadRepo = require('../uploads/upload.repository');

const pendingDispatches = new Map();
let recoveryTimer = null;

function resolveVideoDiskPath(storagePath) {
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.resolve(config.storage.localDir, storagePath);
}

/**
 * Dispatch a queued video processing run to FastAPI /process-video-upload
 */
async function dispatchJob(job) {
  const {
    uploadId, runId, generation, cameraId, enableDehaze, frameStride, storagePath,
    storageProvider: rawStorageProvider, storageBucket,
  } = job;
  if (!cameraId || !String(cameraId).trim()) {
    throw new Error('A registered camera ID is required to process uploaded footage');
  }
  const storageProvider = String(rawStorageProvider || 'LOCAL').toUpperCase();
  if (!['LOCAL', 'S3'].includes(storageProvider)) throw new Error(`Unsupported video storage provider: ${storageProvider}`);
  if (!storagePath) throw new Error('A video storage key is required to process uploaded footage');
  const payload = {
    storage_provider: storageProvider,
    video_path: storageProvider === 'LOCAL' ? resolveVideoDiskPath(storagePath) : null,
    storage_bucket: storageProvider === 'S3' ? (storageBucket || config.storage.s3Bucket) : null,
    storage_key: storagePath,
    video_upload_id: uploadId,
    processing_run_id: runId,
    run_number: generation || 1,
    camera_id: cameraId,
    enable_dehaze: Boolean(enableDehaze),
    frame_stride: parseInt(frameStride || 5, 10),
  };
  if (storageProvider === 'S3' && !payload.storage_bucket) {
    throw new Error('A persisted S3 bucket reference is required to process uploaded footage');
  }
  const aiUrl = `${config.aiService.baseUrl}/process-video-upload`;
  logger.info({ uploadId, runId, aiUrl, storageProvider }, 'Dispatching video processing run to FastAPI');
  const response = await axios.post(aiUrl, payload, { timeout: 15000 });

  // Update DB status to PROCESSING
  await query(
    `UPDATE video_processing_runs SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1`,
    [runId]
  );
  await uploadRepo.updateStatus(uploadId, 'PROCESSING');

  logger.info({ uploadId, runId, jobId: response.data.job_id }, 'Successfully accepted by AI microservice');
  return response.data;
}

/**
 * Enqueue a job with automated retry and backoff
 */
async function enqueueAndDispatch(job, attempt = 1) {
  const maxAttempts = 5;
  try {
    return await dispatchJob(job);
  } catch (err) {
    logger.warn(
      { uploadId: job.uploadId, runId: job.runId, attempt, maxAttempts, err: err.message },
      'AI microservice dispatch attempt failed'
    );

    if (attempt < maxAttempts) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
      setTimeout(() => {
        enqueueAndDispatch(job, attempt + 1).catch(() => {});
      }, delayMs);
    } else {
      logger.error(
        { uploadId: job.uploadId, runId: job.runId },
        'AI microservice dispatch exhausted all retries. Marking run FAILED.'
      );
      try {
        await query(
          `UPDATE video_processing_runs SET status = 'FAILED', failure_reason = $1, updated_at = NOW() WHERE id = $2`,
          [`Failed to connect to AI inference service after ${maxAttempts} attempts: ${err.message}`, job.runId]
        );
        await uploadRepo.updateStatus(job.uploadId, 'FAILED');
      } catch (dbErr) {
        logger.error({ err: dbErr.message }, 'Failed to record FAILED status for stranded run');
      }
    }
  }
}

/**
 * Scan database on startup / periodically for stranded QUEUED runs and recover them
 */
async function scanAndRecoverQueuedRuns() {
  try {
    const res = await query(`
      SELECT r.id AS "runId", r.video_upload_id AS "uploadId", r.generation,
             r.frame_stride AS "frameStride", r.enable_dehaze AS "enableDehaze",
             u.camera_id AS "cameraId", u.storage_key AS "storagePath",
             u.storage_provider AS "storageProvider", u.storage_bucket AS "storageBucket"
      FROM video_processing_runs r
      JOIN video_uploads u ON r.video_upload_id = u.id
      WHERE r.status = 'QUEUED'
      ORDER BY r.created_at ASC
      LIMIT 10
    `);

    for (const row of res.rows) {
      if (!pendingDispatches.has(row.runId)) {
        pendingDispatches.set(row.runId, true);
        logger.info({ runId: row.runId, uploadId: row.uploadId }, 'Recovering un-dispatched queued run');
        enqueueAndDispatch(row).finally(() => {
          pendingDispatches.delete(row.runId);
        });
      }
    }
  } catch (err) {
    // Database may be offline or initializing
    logger.debug({ err: err.message }, 'Recovery scanner idle (DB offline or initializing)');
  }
}

function startRecoveryWorker(intervalMs = 15000) {
  if (!recoveryTimer) {
    // Initial scan after 2 seconds
    setTimeout(scanAndRecoverQueuedRuns, 2000).unref();
    recoveryTimer = setInterval(scanAndRecoverQueuedRuns, intervalMs);
    recoveryTimer.unref();
    logger.info('Durable AI Dispatch & Recovery Worker started');
  }
}

function stopRecoveryWorker() {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
}

module.exports = {
  dispatchJob,
  enqueueAndDispatch,
  scanAndRecoverQueuedRuns,
  startRecoveryWorker,
  stopRecoveryWorker,
};
