const express = require('express');
const { checkDbHealth } = require('../../database/pool');
const { checkRedisHealth } = require('../../integrations/redis/client');

const router = express.Router();
const SERVICE_NAME = 'city-ai-backend';
const VERSION = '0.1.0';

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Liveness is deliberately dependency-free: it answers whether this process
// can serve HTTP, even while the database or Redis is unavailable.
router.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: SERVICE_NAME,
    version: VERSION,
    timestamp: new Date().toISOString(),
  });
});

// Readiness is used by orchestration and includes bounded dependency checks.
// A running process must not be reported healthy when it cannot persist work.
router.get('/ready', async (req, res) => {
  const [databaseResult, redisResult] = await Promise.all([
    withTimeout(checkDbHealth(), 2500),
    withTimeout(checkRedisHealth(), 2500),
  ]);

  const databaseReady = Boolean(databaseResult && databaseResult.ok === true);
  const redisReady = Boolean(redisResult && redisResult.status === 'UP');
  const ready = databaseReady && redisReady;

  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    dependencies: {
      database: databaseReady ? 'UP' : 'DOWN',
      redis: redisReady ? 'UP' : 'DEGRADED',
    },
  });
});

module.exports = router;
