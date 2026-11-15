const express = require('express');
const os = require('os');
const multer = require('multer');
const controller = require('./upload.controller');
const { basicAuth } = require('../../middleware/authentication');
const { adminTokenGuard } = require('../../middleware/admin-token');
const config = require('../../config/env');

const router = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: config.storage.maxFileSizeMb * 1024 * 1024,
  },
});

router.post('/upload', upload.single('file'), controller.uploadVideo);
router.get('/', controller.listUploads);
router.get('/:id', controller.getUpload);
router.get('/:id/stream', controller.streamVideo);
// Triggers AI compute on the video — guarded when ADMIN_API_TOKEN is configured.
router.post('/:id/process', adminTokenGuard, controller.processVideo);
router.get('/:id/runs', controller.listRuns);
router.get('/:id/runs/:runId', controller.getRun);
router.get('/:id/detections', controller.getDetections);
router.post('/:id/complete', basicAuth, controller.completeProcessing);
// Deletes the upload row AND its file on disk — guarded when ADMIN_API_TOKEN is configured.
router.delete('/:id', adminTokenGuard, controller.deleteUpload);

module.exports = router;
