const express = require('express');
const controller = require('./vehicle.controller');
const trajectoryController = require('../trajectory/trajectory.controller');

const router = express.Router();

router.get('/recent', controller.getRecentVehicles);
router.get('/:plate', controller.getVehicle);
router.get('/:plate/detections', controller.getDetections);
router.get('/:plate/trajectory', trajectoryController.getVehicleTrajectory);

module.exports = router;
