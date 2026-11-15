const express = require('express');
const controller = require('./identity.controller');

const router = express.Router();

router.get('/', controller.listIdentities);
router.get('/search', controller.searchIdentity);
router.get('/:id', controller.getIdentity);
router.get('/:id/detections', controller.getIdentityDetections);
router.get('/:id/associations', controller.getIdentityAssociations);
router.post('/associate', controller.associate);
router.post('/associations/:id/resolve', controller.resolveAssociation);
router.get('/:id/trajectory', controller.getTrajectory);
router.get('/:id/trajectory/quality', controller.getTrajectoryQuality);

module.exports = router;
