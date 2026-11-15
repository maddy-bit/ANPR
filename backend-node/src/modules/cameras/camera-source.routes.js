const express = require('express');
const controller = require('./camera-source.controller');
const { adminTokenGuard } = require('../../middleware/admin-token');

const router = express.Router();

router.get('/', controller.listSources);
router.post('/quick-import', adminTokenGuard, controller.quickImportSource);
router.post('/', adminTokenGuard, controller.createSource);
router.post('/:id/sync', adminTokenGuard, controller.syncSource);
router.patch('/:id', adminTokenGuard, controller.updateSource);

module.exports = router;
