const express = require('express');
const controller = require('./camera.controller');
const { adminTokenGuard } = require('../../middleware/admin-token');

const router = express.Router();

router.get('/', controller.listCameras);
router.get('/nearby', controller.nearbyCameras);
router.post('/', adminTokenGuard, controller.registerCamera);
router.get('/:cameraId', controller.getCamera);

module.exports = router;
