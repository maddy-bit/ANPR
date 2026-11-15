/**
 * Database Migration Runner for Node.js Backend
 * Flyway-compatible schema history (flyway_schema_history) with:
 *   - CRC32 checksums recorded and validated against applied migrations
 *     (checksum mismatch on an already-applied migration aborts the run,
 *     matching Flyway's fail-fast semantic for detected drift)
 *   - Session-level PostgreSQL advisory lock so concurrent runner
 *     processes cannot race (Flyway community behaves the same way)
 * Semantics intentionally NOT implemented (documented honestly):
 *   repeatable/undo migrations, out-of-order application, baselines, dry-run.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { getPool, closePool } = require('./pool');
const logger = require('../config/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const ADVISORY_LOCK_KEY = 'sih26127_migration_lock';

function computeChecksum(sqlText) {
  // Flyway stores a signed 32-bit CRC32 of the migration content.
  const crc = zlib.crc32(Buffer.from(sqlText, 'utf8'));
  return crc | 0;
}

function toSignedInt32(value) {
  // Checksums read back from PostgreSQL may arrive as unsigned or string values.
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  return n | 0;
}

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS flyway_schema_history (
      installed_rank INT NOT NULL,
      version VARCHAR(50),
      description VARCHAR(200) NOT NULL,
      type VARCHAR(20) NOT NULL,
      script VARCHAR(1000) NOT NULL,
      checksum INT,
      installed_by VARCHAR(100) NOT NULL,
      installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_time INT NOT NULL,
      success BOOLEAN NOT NULL,
      CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank)
    );
  `);
}

async function getAppliedMigrations(client) {
  const res = await client.query(`
    SELECT version, checksum FROM flyway_schema_history WHERE success = TRUE ORDER BY installed_rank ASC
  `);
  const map = new Map();
  for (const row of res.rows) {
    if (row.version) map.set(row.version, row.checksum == null ? null : toSignedInt32(row.checksum));
  }
  return map;
}

function listMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f.startsWith('V'))
    .sort((a, b) => {
      const vA = parseInt(a.slice(1).split('__')[0], 10);
      const vB = parseInt(b.slice(1).split('__')[0], 10);
      return vA - vB;
    });

  const seen = new Set();
  for (const file of files) {
    const match = file.match(/^V(\d+)__(.+)\.sql$/);
    if (!match) continue;
    if (seen.has(match[1])) {
      throw new Error(`Duplicate migration version ${match[1]} detected (files: ${[...seen]} + ${file}). Aborting.`);
    }
    seen.add(match[1]);
  }
  return files;
}

async function runMigrations(options = {}) {
  const rawTargetVersion = options.targetVersion == null ? null : String(options.targetVersion).trim();
  if (rawTargetVersion !== null && !/^\d+$/.test(rawTargetVersion)) {
    throw new Error('targetVersion must be a numeric migration version (for example, 11)');
  }
  const targetVersion = rawTargetVersion === null ? null : String(parseInt(rawTargetVersion, 10));
  const pool = getPool();
  const client = await pool.connect();

  try {
    logger.info('Checking database migration status...');
    await ensureHistoryTable(client);

    // Serialize concurrent runners. Session-level lock held for the whole run.
    const lockRes = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [ADVISORY_LOCK_KEY]);
    if (!lockRes.rows[0].acquired) {
      throw new Error(`Another migration run is in progress (advisory lock '${ADVISORY_LOCK_KEY}' is held). Aborting.`);
    }

    const installed = await getAppliedMigrations(client);
    const files = listMigrationFiles();

    if (targetVersion !== null && !files.some((file) => file.match(/^V(\d+)__(.+)\.sql$/)?.[1] === targetVersion)) {
      throw new Error(`Requested migration V${targetVersion} was not found in ${MIGRATIONS_DIR}`);
    }

    // Validate checksums of already-applied migrations and backfill legacy NULLs.
    for (const file of files) {
      const match = file.match(/^V(\d+)__(.+)\.sql$/);
      if (!match) continue;
      const version = match[1];
      if (!installed.has(version)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const fileChecksum = computeChecksum(sql);
      const storedChecksum = installed.get(version);

      if (storedChecksum === null) {
        await client.query(
          'UPDATE flyway_schema_history SET checksum = $1 WHERE version = $2 AND success = TRUE',
          [fileChecksum, version]
        );
        logger.info({ version, file, checksum: fileChecksum }, 'Backfilled missing checksum for applied migration');
      } else if (storedChecksum !== fileChecksum) {
        throw new Error(
          `Checksum mismatch for applied migration V${version} (${file}): ` +
          `database has ${storedChecksum}, file has ${fileChecksum}. ` +
          'The applied migration file was modified after being applied. Restore the original file or resolve the drift explicitly.'
        );
      }
    }

    let filesToApply = files;
    if (targetVersion !== null) {
      const missingPrerequisites = files
        .filter((file) => {
          const version = parseInt(file.match(/^V(\d+)__/)[1], 10);
          return version < Number(targetVersion);
        })
        .map((file) => file.match(/^V(\d+)__/)[1])
        .filter((version) => !installed.has(version));
      if (missingPrerequisites.length > 0) {
        throw new Error(
          `Cannot apply V${targetVersion}: prerequisite migrations are missing from history: ${missingPrerequisites.map((v) => 'V' + v).join(', ')}. No migration was applied.`
        );
      }
      filesToApply = files.filter((file) => file.match(/^V(\d+)__/)[1] === targetVersion);
    }

    let rankRes = await client.query('SELECT COALESCE(MAX(installed_rank), 0) AS max_rank FROM flyway_schema_history');
    let currentRank = parseInt(rankRes.rows[0].max_rank, 10);

    let applied = 0;
    for (const file of filesToApply) {
      const match = file.match(/^V(\d+)__(.+)\.sql$/);
      if (!match) continue;
      const version = match[1];
      const description = match[2].replace(/_/g, ' ');

      if (installed.has(version)) {
        logger.debug({ version, file }, 'Migration already applied, skipping');
        continue;
      }

      logger.info({ version, file, description }, `Applying migration ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = computeChecksum(sql);

      const start = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        currentRank++;
        const duration = Date.now() - start;

        await client.query(`
          INSERT INTO flyway_schema_history
            (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success)
          VALUES
            ($1, $2, $3, 'SQL', $4, $5, 'node_migrator', CURRENT_TIMESTAMP, $6, TRUE)
        `, [currentRank, version, description, file, checksum, duration]);

        await client.query('COMMIT');
        applied++;
        logger.info({ version, file, durationMs: duration }, `Successfully applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ version, file, err: err.message }, `Migration failed on ${file}: ${err.message}`);
        throw err;
      }
    }

    if (applied === 0) {
      if (targetVersion !== null) {
        logger.info(`Target migration V${targetVersion} is already applied; no schema changes made.`);
      } else {
        logger.info(`All migrations are already up to date. (${files.length} files validated)`);
      }
    } else {
      logger.info(`Database migrations applied successfully. Total: ${applied}`);
    }
  } finally {
    // Release the advisory lock before releasing the client (session-scoped).
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [ADVISORY_LOCK_KEY]);
    } catch (unlockErr) {
      logger.warn({ err: unlockErr.message }, 'Failed to release migration advisory lock (session is closing)');
    }
    client.release();
    await closePool();
  }
}

if (require.main === module) {
  const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
  const targetVersion = targetArg ? targetArg.slice('--target='.length) : null;
  runMigrations({ targetVersion })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
