/**
 * System Operations & Health Controller
 */

const os = require('os');
const axios = require('axios');
const config = require('../../config/env');
const { checkDbHealth, query } = require('../../database/pool');
const { checkRedisHealth } = require('../../integrations/redis/client');

async function getDetailedHealth(req, res, next) {
  try {
    const dbHealth = await checkDbHealth();
    const redisHealth = await checkRedisHealth();

    // Check AI microservice health
    let aiServiceStatus = 'DOWN';
    let aiLatencyMs = null;
    try {
      const start = Date.now();
      const aiRes = await axios.get(`${config.aiService.baseUrl}/health`, { timeout: 2000 });
      aiLatencyMs = Date.now() - start;
      if (aiRes.status === 200) aiServiceStatus = 'UP';
    } catch (e) {
      aiServiceStatus = 'STANDALONE_FALLBACK';
    }

    // Queue and active jobs metrics
    let activeRuns = 0;
    let queuedRuns = 0;
    try {
      const runsRes = await query(`
        SELECT status, COUNT(*) AS count
        FROM video_processing_runs
        GROUP BY status
      `);
      for (const r of runsRes.rows) {
        if (r.status === 'PROCESSING') activeRuns = parseInt(r.count, 10);
        if (r.status === 'QUEUED') queuedRuns = parseInt(r.count, 10);
      }
    } catch (e) {}

    const memoryUsage = process.memoryUsage();

    return res.json({
      status: 'ok',
      service: 'city-ai-backend-node',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      system: {
        platform: os.platform(),
        cpus: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
        freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
        processMemoryMb: {
          rss: Math.round(memoryUsage.rss / (1024 * 1024)),
          heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
          heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
        },
      },
      infrastructure: {
        database: {
          status: dbHealth.ok ? 'UP' : 'DOWN',
          latencyMs: dbHealth.latencyMs || null,
          error: dbHealth.error || null,
        },
        redis: {
          status: redisHealth.status,
          latencyMs: redisHealth.latencyMs,
          error: redisHealth.error || null,
        },
        aiService: {
          status: aiServiceStatus,
          latencyMs: aiLatencyMs,
          baseUrl: config.aiService.baseUrl,
        },
      },
      workload: {
        activeRuns,
        queuedRuns,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getDetailedHealth,
};
