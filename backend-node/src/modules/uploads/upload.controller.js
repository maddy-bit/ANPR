/**
 * Video Upload & Processing Controller
 */

const uploadService = require('./upload.service');
const processingService = require('../processing/processing.service');

async function uploadVideo(req, res, next) {
  try {
    const file = req.file;
    const cameraId = req.body ? req.body.camera_id : null;
    const result = await uploadService.processUpload(file, cameraId);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getUpload(req, res, next) {
  try {
    const upload = await uploadService.getUpload(req.params.id);
    return res.json(upload);
  } catch (err) {
    return next(err);
  }
}

async function listUploads(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const size = parseInt(req.query.size, 10) || 10;
    const { status, camera_id } = req.query;
    const result = await uploadService.findAll({ page, size, status, cameraId: camera_id });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function streamVideo(req, res, next) {
  try {
    const upload = await uploadService.getUpload(req.params.id);
    const rangeHeader = req.headers.range;
    return await uploadService.streamVideo(upload, rangeHeader, res);
  } catch (err) {
    return next(err);
  }
}

async function processVideo(req, res, next) {
  try {
    const uploadId = req.params.id;
    const options = req.body || {};
    const result = await processingService.triggerInferencePipeline(uploadId, options);
    const status = result.is_created === false ? 200 : 202;
    return res.status(status).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listRuns(req, res, next) {
  try {
    const runs = await processingService.listRuns(req.params.id);
    return res.json(runs);
  } catch (err) {
    return next(err);
  }
}

async function getRun(req, res, next) {
  try {
    const run = await processingService.getRun(req.params.id, req.params.runId);
    if (!run) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Processing run not found' });
    }
    return res.json(run);
  } catch (err) {
    return next(err);
  }
}

async function getDetections(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const size = parseInt(req.query.size, 10) || 20;
    const result = await uploadService.findDetectionsByUploadId(req.params.id, { page, size });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function completeProcessing(req, res, next) {
  try {
    const uploadId = req.params.id;
    const runId = req.body.processing_run_id || null;
    await processingService.completeVideoProcessing(uploadId, runId, req.body);
    return res.json({ status: 'UPDATED', video_upload_id: uploadId });
  } catch (err) {
    return next(err);
  }
}

async function deleteUpload(req, res, next) {
  try {
    await uploadService.deleteUpload(req.params.id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  uploadVideo,
  getUpload,
  listUploads,
  streamVideo,
  processVideo,
  listRuns,
  getRun,
  getDetections,
  completeProcessing,
  deleteUpload,
};
