/**
 * Processing Run Orchestration Service
 */

const crypto = require('crypto');
const processingRepo = require('./processing.repository');
const uploadRepo = require('../uploads/upload.repository');
const outboxService = require('./outbox.service');
const config = require('../../config/env');
const logger = require('../../config/logger');
const { withTransaction } = require('../../database/pool');

async function triggerInferencePipeline(uploadId, options = {}) {
  const upload = await uploadRepo.findById(uploadId);
  if (!upload) {
    const err = new Error(`Video upload not found: ${uploadId}`);
    err.status = 404;
    throw err;
  }

  const cameraId = String(upload.cameraId || '').trim();
  if (!cameraId) {
    const err = new Error('Assign this upload to a registered camera before starting AI processing');
    err.status = 400;
    throw err;
  }

  const clientRunToken = options.client_run_token || options.clientRunToken || null;
  const reprocess = Boolean(options.reprocess);
  const enableDehaze = Boolean(options.enable_dehaze || options.enableDehaze);
  const frameStride = parseInt(options.frame_stride || options.frameStride || 5, 10);

  if (frameStride <= 0) {
    const err = new Error(`frame_stride must be a positive integer, got: ${frameStride}`);
    err.status = 400;
    throw err;
  }

  // Idempotency Deduplication: Check if run with identical client_run_token already exists
  if (clientRunToken) {
    const existingRun = await processingRepo.findByToken(uploadId, clientRunToken);
    if (existingRun && !reprocess) {
      logger.info({ uploadId, clientRunToken, runId: existingRun.id }, 'Returning existing processing run for duplicate token');
      return {
        video_upload_id: uploadId,
        processing_run_id: existingRun.id,
        generation: existingRun.generation,
        status: existingRun.status,
        is_created: false,
      };
    }
  }

  const nextGeneration = (upload.activeRunGeneration || 0) + 1;
  const runId = crypto.randomUUID();

  // Compute config hash
  const configStr = `${frameStride}_${enableDehaze}`;
  const configHash = crypto.createHash('sha256').update(configStr).digest('hex').substring(0, 16);

  // Run row and upload status are committed atomically: a crash between the two
  // writes previously left the upload stuck in a stale status. The QUEUED row is
  // the durable outbox artifact the recovery worker scans for.
  await withTransaction(async (tx) => {
    await processingRepo.createRun({
      id: runId,
      videoUploadId: uploadId,
      generation: nextGeneration,
      clientRunToken,
      status: 'QUEUED',
      frameStride,
      enableDehaze,
      configHash,
      startedAt: new Date(),
    }, tx);

    await uploadRepo.updateStatus(uploadId, 'PROCESSING', nextGeneration, tx);
  });

  // Durable Outbox Dispatch: Trigger AI Service with automatic retry and persistence
  outboxService.enqueueAndDispatch({
    uploadId,
    runId,
    generation: nextGeneration,
    cameraId,
    storagePath: upload.storagePath || upload.storageKey,
    storageProvider: upload.storageProvider || 'LOCAL',
    storageBucket: upload.storageBucket || null,
    enableDehaze,
    frameStride,
  }).catch((err) => {
    logger.warn({ uploadId, runId, err: err.message }, 'Outbox dispatch scheduled with retry worker');
  });

  return {
    video_upload_id: uploadId,
    processing_run_id: runId,
    generation: nextGeneration,
    status: 'QUEUED',
    is_created: true,
  };
}

async function completeVideoProcessing(uploadId, runId, stats) {
  const upload = await uploadRepo.findById(uploadId);
  if (!upload) {
    const err = new Error(`Video upload not found: ${uploadId}`);
    err.status = 404;
    throw err;
  }

  const finalStatus = stats.error ? 'FAILED' : 'COMPLETED';
  await processingRepo.completeRun(uploadId, runId, {
    status: finalStatus,
    framesProcessed: stats.frames_processed || stats.framesProcessed || 0,
    detectionsCount: stats.detections_count || stats.detectionsCount || 0,
    durationSeconds: stats.duration_seconds || stats.durationSeconds || null,
    errorMessage: stats.error || null,
    manifestPath: stats.manifest_path || stats.manifestPath || null,
    manifestSha256: stats.manifest_sha256 || stats.manifestSha256 || null,
  });

  await uploadRepo.updateStatus(uploadId, finalStatus);
  logger.info({ uploadId, runId, finalStatus }, 'Video processing run completed');
}

module.exports = {
  triggerInferencePipeline,
  completeVideoProcessing,
  listRuns: processingRepo.findByUploadId,
  getRun: processingRepo.findById,
};
