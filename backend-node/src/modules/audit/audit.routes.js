const express = require('express');
const controller = require('./audit.controller');
const { basicAuth } = require('../../middleware/authentication');

const router = express.Router();

router.get('/recent', basicAuth, controller.recent);

module.exports = router;
