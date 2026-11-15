const express = require('express');
const os = require('os');
const multer = require('multer');
const controller = require('./ai-proxy.controller');
const config = require('../../config/env');

const router = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: config.storage.maxFileSizeMb * 1024 * 1024,
  },
});

router.get('/watchlist', controller.getWatchlist);
router.post('/watchlist', controller.addWatchlistEntry);
router.post('/process-video', controller.processVideoFeed);
router.get('/security-alerts', controller.getSecurityAlerts);
router.get('/predict-trajectory/:globalId', controller.predictTrajectory);
router.get('/jobs/:jobId', controller.getJobStatus);
router.post('/ingest-camera/:cameraId', controller.ingestCameraFootage);
router.post('/upload-video', upload.single('file'), controller.uploadVideoProxy);

module.exports = router;
