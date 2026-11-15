const express = require('express');
const controller = require('./system.controller');

const router = express.Router();

router.get('/health/detailed', controller.getDetailedHealth);

module.exports = router;
