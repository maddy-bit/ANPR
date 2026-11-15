const crypto = require('crypto');
const { query, withTransaction } = require('../../database/pool');
const { executeTool } = require('./tool-registry');
const { findCandidatesForCase } = require('../cameras/camera-discovery.service');
const logger = require('../../config/logger');

const POLL_MS = Math.max(1000, Number(process.env.INVESTIGATION_JOB_POLL_MS) || 3000);
const LIVE_TTL_MS = Math.max(60000, Number(process.env.INVESTIGATION_LIVE_TTL_MS) || 60 * 60 * 1000);
const LEASE_MS = Math.max(10000, Number(process.env.INVESTIGATION_JOB_LEASE_MS) || 30000);
let timer = null;
let busy = false;

async function enqueue({ caseId, plate, mode, requestKey }) {
  const id = crypto.randomUUID();
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + LIVE_TTL_MS);
  const result = await query(
    `INSERT INTO investigation_tracking_jobs
      (id, case_id, target_plate, mode, status, request_key, requested_at, expires_at)
     VALUES ($1,$2,$3,$4,'QUEUED',$5,$6,$7)
     ON CONFLICT (case_id, request_key) DO UPDATE SET updated_at = NOW()
     RETURNING id, case_id AS "caseId", target_plate AS "targetPlate", mode, status,
       requested_at AS "requestedAt", expires_at AS "expiresAt", cursor_detection_id AS "cursorDetectionId",
       result, error_code AS "errorCode", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, caseId, plate, mode, requestKey, requestedAt, expiresAt]
  );
  return result.rows[0];
}

async function getJob(id, caseId) {
  const result = await query(
    `SELECT id, case_id AS "caseId", target_plate AS "targetPlate", mode, status,
       requested_at AS "requestedAt", expires_at AS "expiresAt", cursor_detection_id AS "cursorDetectionId",
       result, error_code AS "errorCode", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
     FROM investigation_tracking_jobs WHERE id=$1 AND case_id=$2`, [id, caseId]
  );
  return result.rows[0] || null;
}

async function cancelJob(id, caseId) {
  const result = await query(
    `UPDATE investigation_tracking_jobs SET status='CANCELLED', lease_token=NULL, lease_until=NULL,
       updated_at=NOW(), completed_at=NOW()
     WHERE id=$1 AND case_id=$2 AND status IN ('QUEUED','RUNNING','WAITING_FOR_OBSERVATIONS')
     RETURNING id, case_id AS "caseId", status`, [id, caseId]
  );
  return result.rows[0] || null;
}

async function claimOne() {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE investigation_tracking_jobs SET status='FAILED', error_code='RETRY_LIMIT',
         lease_token=NULL, lease_until=NULL, completed_at=NOW(), updated_at=NOW()
       WHERE status='RUNNING' AND lease_until < NOW() AND attempt_count >= max_attempts`
    );
    const result = await client.query(
      `WITH candidate AS (
         SELECT id FROM investigation_tracking_jobs
         WHERE status IN ('QUEUED','WAITING_FOR_OBSERVATIONS','RUNNING')
           AND next_attempt_at <= NOW()
           AND attempt_count < max_attempts
           AND (lease_until IS NULL OR lease_until < NOW())
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE investigation_tracking_jobs j SET status='RUNNING', lease_token=$1,
         lease_until=NOW() + ($2 * INTERVAL '1 millisecond'), started_at=COALESCE(started_at,NOW()),
         attempt_count=attempt_count+1, updated_at=NOW()
       FROM candidate WHERE j.id=candidate.id
       RETURNING j.*`, [crypto.randomUUID(), LEASE_MS]
    );
    return result.rows[0] || null;
  });
}

async function complete(job, patch) {
  await query(
    `UPDATE investigation_tracking_jobs SET status=$3, result=$4::jsonb, cursor_detection_id=$5,
       next_attempt_at=$6, lease_token=NULL, lease_until=NULL, error_code=$7,
       completed_at=CASE WHEN $3 IN ('COMPLETED','FAILED','CANCELLED') THEN NOW() ELSE NULL END,
       updated_at=NOW()
     WHERE id=$1 AND lease_token=$2`,
    [job.id, job.lease_token, patch.status, JSON.stringify(patch.result), patch.cursorDetectionId,
      patch.nextAttemptAt || new Date(Date.now() + POLL_MS), patch.errorCode || null]
  );
}

function toObservedPoint(row) {
  const latitude = row.latitude == null ? null : Number(row.latitude);
  const longitude = row.longitude == null ? null : Number(row.longitude);
  return {
    detectionId: row.id,
    cameraId: row.cameraId,
    cameraName: row.cameraName || null,
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null,
    timestamp: row.timestamp,
    ingestedAt: row.ingestedAt,
    confidence: row.confidence == null ? null : Number(row.confidence),
    provenance: { source: 'PERSISTED_DETECTION', detectionId: row.id, processingRunId: row.processingRunId || null },
  };
}

function safeRouteExpansion(expansion) {
  return {
    detectionId: expansion.seedDetectionId,
    candidateStages: expansion.candidateStages,
    candidates: expansion.candidates.map((camera) => ({
      id: camera.id,
      name: camera.name,
      latitude: camera.latitude,
      longitude: camera.longitude,
      sourceType: camera.sourceType,
      sourceName: camera.sourceName,
      attribution: camera.attribution,
      routeRelation: camera.routeRelation,
      investigationStage: camera.investigationStage,
      processingCapability: camera.processingCapability,
      priority: camera.priority,
      verifiedCameraEdge: camera.verifiedCameraEdge,
      roadName: camera.roadName,
      roadDistanceMeters: camera.roadDistanceMeters,
      estimatedArrivalWindowSeconds: camera.estimatedArrivalWindowSeconds,
    })),
    status: 'CAMERA_METADATA_ONLY',
    warnings: expansion.warnings,
  };
}

async function processJob(job) {
  let result = job.result || {};
  let cursor = Number(job.cursor_detection_id) || 0;
  const caseResult = await query('SELECT * FROM investigations WHERE id=$1', [job.case_id]);
  const caseItem = caseResult.rows[0];
  if (!caseItem || caseItem.status === 'CLOSED' || caseItem.status === 'ARCHIVED') {
    return complete(job, { status: 'CANCELLED', result, cursorDetectionId: cursor, errorCode: 'CASE_NOT_ACTIVE' });
  }
  if (new Date(job.expires_at).getTime() <= Date.now()) {
    return complete(job, { status: 'COMPLETED', result: { ...result, trackingEnded: 'REQUEST_WINDOW_EXPIRED' }, cursorDetectionId: cursor });
  }

  if (job.mode !== 'LIVE' && !result.historicLoaded) {
    const trajectory = await executeTool('get_vehicle_trajectory', {
      plate: job.target_plate, caseId: job.case_id, limit: 1000,
    });
    result = {
      ...result,
      historicLoaded: true,
      historical: trajectory,
      observedPoints: (trajectory.points || []).map((point) => ({
        ...point,
        provenance: { source: 'PERSISTED_DETECTION', detectionId: point.detectionId || null, processingRunId: point.processingRunId || null },
      })),
    };
    if (trajectory.truncated) {
      result.warnings = [...new Set([...(result.warnings || []), 'Historical results reached the 1,000 point response cap. Narrow the case time window to inspect a smaller interval.'])];
    }
    cursor = Math.max(cursor, ...((trajectory.points || []).map((point) => Number(point.detectionId) || 0)), 0);
    const seed = (trajectory.points || []).at(-1);
    if (seed && caseItem.search_center_lat != null && caseItem.search_center_lon != null
      && caseItem.search_radius_km != null && caseItem.search_start_at && caseItem.search_end_at) {
      try {
        const expansion = await findCandidatesForCase(
          caseItem, seed.detectionId, Math.min(Number(caseItem.search_radius_km), 25)
        );
        result.routeExpansions = [safeRouteExpansion(expansion)];
      } catch {
        result.warnings = ['Route candidate expansion could not be completed for the latest historical observation.'];
      }
    }
  }

  if (job.mode === 'HISTORIC') {
    return complete(job, { status: 'COMPLETED', result, cursorDetectionId: cursor });
  }

  // Source event time is bounded by the case scope. Ingestion time is separate
  // and is used only to ensure that LIVE means observations arriving after enqueue.
  const rows = await query(
    `SELECT d.id, d.camera_id AS "cameraId", c.name AS "cameraName", d.latitude, d.longitude,
       d.timestamp, d.ingested_at AS "ingestedAt", d.detection_confidence AS confidence,
       d.processing_run_id AS "processingRunId"
     FROM vehicle_detections d
     JOIN cameras c ON c.id=d.camera_id
     JOIN investigations i ON i.id=$1
     WHERE d.id > $2 AND d.ingested_at >= $3 AND d.plate_text_normalized=$4
       AND i.linked_plate=$4
       AND (i.search_start_at IS NULL OR d.timestamp >= i.search_start_at)
       AND (i.search_end_at IS NULL OR d.timestamp <= i.search_end_at)
       AND (i.search_center_lat IS NULL OR i.search_radius_km IS NULL OR ST_DWithin(
         d.location, ST_SetSRID(ST_MakePoint(i.search_center_lon,i.search_center_lat),4326)::geography,
         i.search_radius_km * 1000))
     ORDER BY d.id ASC LIMIT 500`,
    [job.case_id, cursor, job.requested_at, job.target_plate]
  );
  const points = rows.rows.map(toObservedPoint);
  cursor = Math.max(cursor, ...rows.rows.map((row) => Number(row.id) || 0), 0);
  const allObservedPoints = [...(result.observedPoints || []), ...points];
  const observedPoints = allObservedPoints.slice(-5000);
  const routeExpansions = [...(result.routeExpansions || [])];
  const warnings = new Set(result.warnings || []);
  if (points.length) {
    const newest = rows.rows[rows.rows.length - 1];
    if (caseItem.search_center_lat != null && caseItem.search_center_lon != null && caseItem.search_radius_km != null
      && caseItem.search_start_at && caseItem.search_end_at) {
      try {
        const candidates = await findCandidatesForCase(caseItem, newest.id, Math.min(Number(caseItem.search_radius_km), 25));
        routeExpansions.push(safeRouteExpansion(candidates));
      } catch (err) {
        warnings.add('Route candidate expansion was unavailable for the latest observation.');
      }
    } else {
      warnings.add('Route candidate expansion requires a case centre, radius and start/end time window.');
    }
  }
  warnings.add('Live tracking consumes newly persisted detections only; no camera feed is opened or inferred by this job worker.');
  const next = {
    ...result,
    observedPoints,
    observedPointCount: (Number(result.observedPointCount) || 0) + points.length,
    observedPointsTruncated: Boolean(result.observedPointsTruncated) || allObservedPoints.length > 5000,
    routeExpansions: routeExpansions.slice(-100),
    warnings: [...warnings],
  };
  return complete(job, {
    status: 'WAITING_FOR_OBSERVATIONS', result: next, cursorDetectionId: cursor,
    nextAttemptAt: new Date(Date.now() + POLL_MS),
  });
}

async function runOnce() {
  if (busy) return;
  busy = true;
  try {
    const job = await claimOne();
    if (job) await processJob(job);
  } catch (err) {
    logger.error({ err: err.message }, 'Investigation tracking worker iteration failed');
  } finally {
    busy = false;
  }
}

function startWorker() {
  if (timer) return;
  timer = setInterval(runOnce, POLL_MS);
  timer.unref();
  void runOnce();
}

function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { enqueue, getJob, cancelJob, startWorker, stopWorker, runOnce, claimOne, processJob };

