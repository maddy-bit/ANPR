const express = require('express');
const controller = require('./investigation.controller');
const discoveryController = require('./camera-discovery.controller');

const router = express.Router();

router.get('/', controller.listCases);
router.post('/', controller.createCase);
router.post('/:id/camera-candidates', discoveryController.cameraCandidates);
router.get('/:id', controller.getCase);
router.patch('/:id', controller.updateCase);
router.post('/:id/notes', controller.addNote);

module.exports = router;
