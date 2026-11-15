/**
 * Redis-Backed Rate Limiter Middleware
 * Uses atomic Lua script (INCR + conditional EXPIRE).
 * Fails open gracefully with bounded in-memory fallback if Redis is unavailable.
 */

const { getRedisClient } = require('../integrations/redis/client');
const config = require('../config/env');
const logger = require('../config/logger');

const LUA_ATOMIC_RATE_LIMIT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

// Fallback in-memory map with periodic pruning to prevent memory leaks
const memoryBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of memoryBuckets.entries()) {
    if (bucket.resetAt < now) {
      memoryBuckets.delete(ip);
    }
  }
}, 60000).unref();

async function rateLimiter(req, res, next) {
  if (!config.rateLimit.enabled) {
    return next();
  }

  const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const key = `ratelimit:${clientIp}`;
  const maxRpm = config.rateLimit.rpm;
  // Window matches the advertised per-minute limit (previously hardcoded 65s).
  const windowSeconds = 60;

  try {
    const redis = getRedisClient();
    const count = await redis.eval(LUA_ATOMIC_RATE_LIMIT, 1, key, windowSeconds);

    res.setHeader('X-RateLimit-Limit', maxRpm);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRpm - count));

    if (count > maxRpm) {
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Maximum ' + maxRpm + ' requests per minute.',
      });
    }

    return next();
  } catch (err) {
    // Redis unavailable: gracefully fail open using bounded in-memory counter
    logger.debug({ err: err.message }, 'Redis rate limiter offline, falling back to in-memory');

    const now = Date.now();
    let bucket = memoryBuckets.get(clientIp);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + 60000 };
      memoryBuckets.set(clientIp, bucket);
    }
    bucket.count++;

    if (bucket.count > maxRpm) {
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. Maximum ' + maxRpm + ' requests per minute.',
      });
    }

    return next();
  }
}

module.exports = {
  rateLimiter,
  LUA_ATOMIC_RATE_LIMIT,
};
