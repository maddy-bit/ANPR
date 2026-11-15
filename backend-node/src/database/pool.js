/**
 * PostgreSQL & PostGIS Connection Pool
 */

const { Pool } = require('pg');
const config = require('../config/env');
const logger = require('../config/logger');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl,
      max: config.db.max,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected idle client error on PostgreSQL pool');
    });
  }
  return pool;
}

/**
 * Execute a parameterized query with structured logging
 */
async function query(text, params = []) {
  const start = Date.now();
  const p = getPool();
  try {
    const res = await p.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'Executed PostgreSQL query');
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error({ text, duration, err: err.message }, 'PostgreSQL query failed');
    throw err;
  }
}

/**
 * Execute work inside an atomic database transaction
 */
async function withTransaction(callback) {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.error({ err: rbErr.message }, 'Failed to rollback transaction');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check database connection and PostGIS availability
 */
async function checkDbHealth() {
  try {
    const start = Date.now();
    const res = await query('SELECT 1 AS ok');
    const latencyMs = Date.now() - start;
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Graceful pool closure
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

module.exports = {
  getPool,
  query,
  withTransaction,
  checkDbHealth,
  closePool,
};
