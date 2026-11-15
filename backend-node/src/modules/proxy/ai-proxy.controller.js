/**
 * AI Proxy Controller
 * Forwards requests to Python FastAPI microservice with strict timeouts and error classification.
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const config = require('../../config/env');
const logger = require('../../config/logger');

const client = axios.create({
  baseURL: config.aiService.baseUrl,
  timeout: config.aiService.timeoutMs,
});

async function getWatchlist(req, res) {
  try {
    const response = await client.get('/watchlist');
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to fetch /watchlist from AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Watchlist service is currently unavailable.',
    });
  }
}

async function addWatchlistEntry(req, res) {
  try {
    const response = await client.post('/watchlist', req.body);
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to post /watchlist to AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Watchlist service is currently unavailable.',
    });
  }
}

async function processVideoFeed(req, res) {
  try {
    const response = await client.post('/process-video', req.body);
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to post /process-video to AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Video processing service is currently unavailable.',
    });
  }
}

async function getSecurityAlerts(req, res) {
  try {
    const response = await client.get('/security-alerts');
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to fetch /security-alerts from AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Security alerts service is currently unavailable.',
    });
  }
}

async function predictTrajectory(req, res) {
  try {
    const globalId = req.params.globalId;
    const response = await client.get(`/predict-trajectory/${globalId}`);
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message, globalId: req.params.globalId }, 'Failed to predict trajectory from AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Trajectory prediction service is currently unavailable.',
    });
  }
}

async function getJobStatus(req, res) {
  try {
    const jobId = req.params.jobId;
    const response = await client.get(`/jobs/${jobId}`);
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message, jobId: req.params.jobId }, 'Failed to fetch job status from AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Job status service is currently unavailable.',
    });
  }
}

async function ingestCameraFootage(req, res) {
  try {
    const cameraId = req.params.cameraId;
    const response = await client.post(`/ingest-camera/${cameraId}`, req.body);
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message, cameraId: req.params.cameraId }, 'Failed to ingest camera footage to AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Camera ingestion service is currently unavailable.',
    });
  }
}

async function uploadVideoProxy(req, res) {
  const cameraId = String((req.body && req.body.camera_id) || '').trim();
  if (!cameraId) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'A registered camera ID is required to process uploaded footage' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'File must not be empty' });
  }

  const formData = new FormData();
  formData.append('file', fs.createReadStream(req.file.path), req.file.originalname);
  formData.append('camera_id', cameraId);
  formData.append('enable_dehaze', String(req.body.enable_dehaze || false));
  // Preserve only a caller-supplied capture timestamp; never synthesize one.
  if (req.body.start_time) {
    formData.append('start_time', req.body.start_time);
  }
  formData.append('frame_stride', String(req.body.frame_stride || 5));

  try {
    const response = await client.post('/upload-video', formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to forward /upload-video to AI microservice');
    return res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Video upload processing service is currently unavailable.',
    });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
  }
}

module.exports = {
  getWatchlist,
  addWatchlistEntry,
  processVideoFeed,
  getSecurityAlerts,
  predictTrajectory,
  getJobStatus,
  ingestCameraFootage,
  uploadVideoProxy,
};
