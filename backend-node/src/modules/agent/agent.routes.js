const express = require('express');
const controller = require('./agent.controller');

const router = express.Router();

router.post('/chat', controller.chat);
router.get('/conversations/:id', controller.getConversation);
router.get('/tools', controller.listTools);

module.exports = router;
