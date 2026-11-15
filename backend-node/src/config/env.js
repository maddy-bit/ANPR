/**
 * Central Environment & Configuration Manager
 * Enforces fail-closed validation, loopback restriction, and security policies.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from cwd and fallback to repo root .env
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parseDbConfig() {
  const rawUrl = process.env.DB_URL;
  const runtimeEnvironment = process.env.NODE_ENV || 'development';
  const allowManagedDatabase = runtimeEnvironment === 'production'
    && process.env.ALLOW_REMOTE_DATABASE === 'true'
    && process.env.DB_SSL === 'true';
  const user = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;

  const forbiddenPatterns = [/supabase\.com/i, /pooler\.supabase\.com/i, /aws-0-ap-southeast-1/i, /\.rds\.amazonaws\.com/i];

  const allowedHosts = ['127.0.0.1', 'localhost', 'db', 'postgres', 'cityai_postgres'];

  if (!rawUrl) {
    if (runtimeEnvironment === 'production' && !process.env.DB_HOST) {
      throw new Error('SECURITY FATAL: DB_URL or DB_HOST must be explicitly configured in production.');
    }
    const host = process.env.DB_HOST || '127.0.0.1';
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(host)) {
        throw new Error(`SECURITY FATAL: DB_HOST contains forbidden remote pattern '${pattern}'. Aborting.`);
      }
    }
    if (!allowedHosts.includes(host) && !allowManagedDatabase) {
      throw new Error('SECURITY FATAL: Remote PostgreSQL requires production mode, ALLOW_REMOTE_DATABASE=true, and DB_SSL=true.');
    }
    if (!allowedHosts.includes(host) && (!process.env.DB_USERNAME || !process.env.DB_PASSWORD)) {
      throw new Error('SECURITY FATAL: Explicit DB_USERNAME and DB_PASSWORD are required for a managed database.');
    }
    return {
      host,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'cityaidb',
      user,
      password,
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT || '10000', 10),
      ...(allowedHosts.includes(host) ? {} : { ssl: { rejectUnauthorized: true } }),
    };
  }

  // Strict Fail-Closed Remote Isolation Guard
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(rawUrl)) {
      throw new Error(`SECURITY FATAL: DB_URL contains forbidden remote pattern '${pattern}'. Aborting.`);
    }
  }

  // Handle JDBC URL syntax: jdbc:postgresql://host:port/db
  let cleanUrl = rawUrl;
  if (cleanUrl.startsWith('jdbc:')) {
    cleanUrl = cleanUrl.substring(5);
  }

  try {
    const parsed = new URL(cleanUrl);
    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const database = parsed.pathname.replace(/^\//, '');

    // Remote databases are an explicit production-only opt-in and always use verified TLS.
    if (!allowedHosts.includes(host) && !allowManagedDatabase) {
      throw new Error('SECURITY FATAL: Remote PostgreSQL requires production mode, ALLOW_REMOTE_DATABASE=true, and DB_SSL=true.');
    }
    if (!allowedHosts.includes(host) && (!(parsed.username || process.env.DB_USERNAME) || !(parsed.password || process.env.DB_PASSWORD))) {
      throw new Error('SECURITY FATAL: Explicit database credentials are required for a managed database.');
    }

    return {
      host,
      port,
      database: database || 'cityaidb',
      user: parsed.username || user,
      password: parsed.password || password,
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONN_TIMEOUT || '10000', 10),
      ...(allowedHosts.includes(host) ? {} : { ssl: { rejectUnauthorized: true } }),
    };
  } catch (err) {
    if (err.message.startsWith('SECURITY FATAL')) throw err;
    throw new Error(`Malformed DB_URL (${err.message})`);
  }
}

const repoRoot = path.resolve(__dirname, '../../..');

function parseRedisConfig() {
  const rawUrl = process.env.REDIS_URL;
  const localHosts = ['127.0.0.1', 'localhost', '::1', '[::1]', 'redis'];
  if (rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw new Error('Malformed REDIS_URL'); }
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }
    const isLocal = localHosts.includes(parsed.hostname.toLowerCase());
    if (!isLocal && !((process.env.NODE_ENV || 'development') === 'production' && process.env.ALLOW_REMOTE_REDIS === 'true')) {
      throw new Error('SECURITY FATAL: Remote Redis requires production mode and ALLOW_REMOTE_REDIS=true.');
    }
    return {
      url: rawUrl,
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || null,
      enableOfflineQueue: false,
      retryStrategy(times) { return Math.min(times * 100, 2000); },
    };
  }
  return {
    url: null,
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || null,
    enableOfflineQueue: false,
    retryStrategy(times) { return Math.min(times * 100, 2000); },
  };
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10),
  // Host-run development binds to loopback. Container/production deployments bind to 0.0.0.0.
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),

  db: parseDbConfig(),

  redis: parseRedisConfig(),

  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rpm: parseInt(process.env.RATE_LIMIT_RPM || '300', 10),
  },

  ingest: {
    username: process.env.INGEST_USERNAME,
    password: process.env.INGEST_PASSWORD,
  },

  security: {
    // Opt-in guards: when these tokens are set, the corresponding routes
    // enforce them (constant-time comparison). Unset = unguarded with a
    // loud startup warning (documented in SECURITY_AUDIT.md).
    adminApiToken: process.env.ADMIN_API_TOKEN || null,
    wsAuthToken: process.env.WS_AUTH_TOKEN || null,
    cameraSourceEncryptionKey: process.env.CAMERA_SOURCE_ENCRYPTION_KEY || null,
  },

  cameraSources: {
    refreshHours: Math.max(6, parseInt(process.env.PUBLIC_CAMERA_CATALOG_REFRESH_HOURS || '24', 10) || 24),
  },

  aiService: {
    baseUrl: (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    timeoutMs: parseInt(process.env.AI_SERVICE_TIMEOUT_MS || '10000', 10),
  },

  storage: {
    provider: String(process.env.STORAGE_PROVIDER || 'local').trim().toUpperCase(),
    s3Region: process.env.AWS_REGION || null,
    s3Bucket: process.env.S3_BUCKET || null,
    maxFileSizeMb: parseInt(process.env.STORAGE_MAX_FILE_SIZE_MB || '500', 10),
    localDir: path.resolve(repoRoot, (process.env.STORAGE_LOCAL_DIR || 'data/uploads').replace(/^(\.\.[\/\\])+/, '')),
    evidenceDir: path.resolve(repoRoot, (process.env.EVIDENCE_DIR || 'data/evidence').replace(/^(\.\.[\/\\])+/, '')),
    videosDir: path.resolve(repoRoot, (process.env.VIDEOS_DIR || 'videos').replace(/^(\.\.[\/\\])+/, '')),
    dataDir: path.resolve(repoRoot, (process.env.DATA_DIR || 'data').replace(/^(\.\.[\/\\])+/, '')),
    seedCameras: process.env.SEED_CAMERAS === 'true',
  },
};

module.exports = config;
module.exports.parseDbConfig = parseDbConfig;
module.exports.parseRedisConfig = parseRedisConfig;

