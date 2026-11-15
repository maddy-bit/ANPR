const express = require('express');
const controller = require('./detection.controller');
const { basicAuth } = require('../../middleware/authentication');

const router = express.Router();

router.post('/ingest', basicAuth, controller.ingest);
router.post('/ingest/batch', basicAuth, controller.ingestBatch);
router.get('/:id/candidates', controller.getCandidates);

module.exports = router;
