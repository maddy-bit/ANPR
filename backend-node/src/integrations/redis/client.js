/**
 * Redis Client & Distributed Coordination Engine
 * Implements Redis Streams, Consumer Groups, Distributed Locks with Lua scripts, and Pub/Sub.
 */

const Redis = require('ioredis');
const config = require('../../config/env');
const logger = require('../../config/logger');

let client = null;
let subscriber = null;

// Real Application Lua Scripts
const LUA_RENEW_LOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("expire", KEYS[1], ARGV[2])
else
    return 0
end
`;

const LUA_RELEASE_LOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

function getRedisClient() {
  if (!client) {
    const options = {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 2000);
      },
    };
    client = config.redis.url
      ? new Redis(config.redis.url, options)
      : new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      ...options,
    });

    client.on('error', (err) => {
      logger.debug({ err: err.message }, 'Redis client offline or connection failed');
    });

    client.on('connect', () => {
      logger.info('Connected to Redis at %s:%d', config.redis.host, config.redis.port);
    });
  }
  return client;
}

function getRedisSubscriber() {
  if (!subscriber) {
    const options = {
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return 500;
      },
    };
    subscriber = config.redis.url
      ? new Redis(config.redis.url, options)
      : new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      ...options,
    });
    subscriber.on('error', (err) => {
      logger.debug({ err: err.message }, 'Redis subscriber error');
    });
  }
  return subscriber;
}

async function ensureConnected(c, timeoutMs = 2000) {
  if (!c) {
    throw new Error('Redis is not ready (connection status: unavailable)');
  }
  if (c.status === 'ready') return true;
  if (c.status === 'connecting' || c.status === 'connect') {
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Redis connection timed out after ${timeoutMs}ms (status: ${c.status})`));
        }, timeoutMs);
        c.once('ready', () => {
          clearTimeout(timer);
          resolve(true);
        });
        c.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return true;
    } catch {
      throw new Error(`Redis is not ready (connection status: ${c.status})`);
    }
  }
  throw new Error(`Redis is not ready (connection status: ${c.status})`);
}

async function checkRedisHealth() {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const start = Date.now();
    const res = await c.ping();
    const latencyMs = Date.now() - start;
    if (res === 'PONG') {
      return { status: 'UP', latencyMs };
    }
    return { status: 'STANDALONE_FALLBACK', latencyMs: null };
  } catch (err) {
    return { status: 'STANDALONE_FALLBACK', latencyMs: null, error: err.message };
  }
}

/**
 * Distributed Lock: Atomic Acquire
 */
async function acquireLock(key, ownerId, ttlSeconds = 120) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const res = await c.set(key, ownerId, 'NX', 'EX', ttlSeconds);
    return res === 'OK';
  } catch (err) {
    logger.debug({ err: err.message, key }, 'Failed to acquire Redis lock');
    return false;
  }
}

/**
 * Distributed Lock: Atomic Renew via Lua Script
 */
async function renewLock(key, ownerId, ttlSeconds = 120) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const res = await c.eval(LUA_RENEW_LOCK, 1, key, ownerId, ttlSeconds);
    return res === 1;
  } catch (err) {
    logger.debug({ err: err.message, key }, 'Failed to renew Redis lock');
    return false;
  }
}

/**
 * Distributed Lock: Atomic Release via Lua Script
 */
async function releaseLock(key, ownerId) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const res = await c.eval(LUA_RELEASE_LOCK, 1, key, ownerId);
    return res === 1;
  } catch (err) {
    logger.debug({ err: err.message, key }, 'Failed to release Redis lock');
    return false;
  }
}

/**
 * Publish message to Redis channel
 */
async function publish(channel, message) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return await c.publish(channel, payload);
  } catch (err) {
    logger.debug({ err: err.message, channel }, 'Failed to publish to Redis');
    return 0;
  }
}

/**
 * Redis Streams: Append entry to stream (XADD)
 */
async function xadd(stream, fields = {}, maxLen = 10000) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const args = [stream, 'MAXLEN', '~', maxLen, '*'];
    for (const [key, val] of Object.entries(fields)) {
      args.push(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
    }
    return await c.xadd(...args);
  } catch (err) {
    logger.debug({ err: err.message, stream }, 'Redis xadd failed');
    return null;
  }
}

/**
 * Redis Streams: Create consumer group (XGROUP CREATE)
 */
async function xgroupCreate(stream, group, id = '$', mkstream = true) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    const args = ['CREATE', stream, group, id];
    if (mkstream) args.push('MKSTREAM');
    return await c.xgroup(...args);
  } catch (err) {
    if (err.message && err.message.includes('BUSYGROUP')) {
      return 'BUSYGROUP';
    }
    logger.debug({ err: err.message, stream, group }, 'Redis xgroup create failed');
    return null;
  }
}

/**
 * Redis Streams: Read from consumer group (XREADGROUP)
 */
async function xreadgroup(group, consumer, stream, id = '>', count = 10, blockMs = 2000) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    return await c.xreadgroup('GROUP', group, consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', stream, id);
  } catch (err) {
    logger.debug({ err: err.message, stream, group }, 'Redis xreadgroup failed');
    return null;
  }
}

/**
 * Redis Streams: Acknowledge processed message (XACK)
 */
async function xack(stream, group, id) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    return await c.xack(stream, group, id);
  } catch (err) {
    logger.debug({ err: err.message, stream, group, id }, 'Redis xack failed');
    return 0;
  }
}

/**
 * Redis Streams: Inspect pending entry list (XPENDING)
 */
async function xpending(stream, group) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    return await c.xpending(stream, group);
  } catch (err) {
    logger.debug({ err: err.message, stream, group }, 'Redis xpending failed');
    return null;
  }
}

/**
 * Redis Streams: Claim stale unacknowledged messages (XAUTOCLAIM)
 */
async function xautoclaim(stream, group, consumer, minIdleTimeMs = 60000, start = '0-0', count = 10) {
  try {
    const c = getRedisClient();
    await ensureConnected(c);
    return await c.xautoclaim(stream, group, consumer, minIdleTimeMs, start, 'COUNT', count);
  } catch (err) {
    logger.debug({ err: err.message, stream, group }, 'Redis xautoclaim failed');
    return null;
  }
}

/**
 * Close Redis connections gracefully
 */
async function closeRedis() {
  if (client) {
    if (client.status === 'ready') {
      await client.quit().catch(() => client.disconnect());
    } else {
      client.disconnect();
    }
    client = null;
  }
  if (subscriber) {
    if (subscriber.status === 'ready') {
      await subscriber.quit().catch(() => subscriber.disconnect());
    } else {
      subscriber.disconnect();
    }
    subscriber = null;
  }
}

module.exports = {
  getRedisClient,
  getRedisSubscriber,
  checkRedisHealth,
  acquireLock,
  renewLock,
  releaseLock,
  publish,
  xadd,
  xgroupCreate,
  xreadgroup,
  xack,
  xpending,
  xautoclaim,
  closeRedis,
  LUA_RENEW_LOCK,
  LUA_RELEASE_LOCK,
};
