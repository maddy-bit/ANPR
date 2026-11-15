const express = require('express');
const controller = require('./agent.controller');

const router = express.Router();

router.post('/chat', controller.chat);
router.get('/conversations/:id', controller.getConversation);
router.get('/tools', controller.listTools);
router.get('/cases/:caseId/jobs/:jobId', controller.getTrackingJob);
router.delete('/cases/:caseId/jobs/:jobId', controller.cancelTrackingJob);

module.exports = router;

