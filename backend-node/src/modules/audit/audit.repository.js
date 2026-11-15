/**
 * Audit Log Repository
 *
 * Column alignment with migrations:
 *   V1__initial_schema.sql creates audit_log_entries(id, timestamp, action, plate, remote_address).
 *   V10__audit_columns_and_investigations.sql adds details, user_id, user_agent.
 * The repository maps the service's ipAddress to the remote_address column.
 */

const { query } = require('../../database/pool');

async function create(entry) {
  const sql = `
    INSERT INTO audit_log_entries (action, details, user_id, remote_address, user_agent, timestamp)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, action, details, user_id AS "userId", remote_address AS "ipAddress", user_agent AS "userAgent", timestamp
  `;
  const params = [
    entry.action,
    entry.details || null,
    entry.userId || 'system',
    entry.ipAddress || null,
    entry.userAgent || null,
    entry.timestamp || new Date(),
  ];
  const res = await query(sql, params);
  return res.rows[0];
}

async function findRecent(limit = 50) {
  const boundedLimit = Math.min(Math.max(1, limit), 500);
  const sql = `
    SELECT id, action, details, user_id AS "userId", remote_address AS "ipAddress", user_agent AS "userAgent", timestamp
    FROM audit_log_entries
    ORDER BY timestamp DESC
    LIMIT $1
  `;
  const res = await query(sql, [boundedLimit]);
  return res.rows;
}

module.exports = {
  create,
  findRecent,
};
