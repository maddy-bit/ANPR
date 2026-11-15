/**
 * Global Identity Association & Trajectory Reconstruction Service
 */

const crypto = require('crypto');
const identityRepo = require('./identity.repository');
const detectionRepo = require('../detections/detection.repository');
const { haversineDistanceKm, calculateSpeedKmh } = require('../../utils/geo-utils');

function parseEmbedding(str) {
  if (!str) return null;
  try {
    if (Array.isArray(str)) return str;
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
  let dot = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0.0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function calculatePlateSimilarity(plateA, plateB) {
  const left = typeof plateA === 'string' ? plateA.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
  const right = typeof plateB === 'string' ? plateB.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
  if (!left || !right) return 0.0;
  if (left === right) return 1.0;

  // Wagner-Fischer Levenshtein distance, normalized by the longer plate length.
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    previous = current;
  }
  const distance = previous[right.length];
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

async function associateDetections(sourceId, candidateId, autoAssign = false) {
  if (sourceId === candidateId) {
    const err = new Error(`Cannot associate a detection with itself: ${sourceId}`);
    err.status = 400;
    throw err;
  }

  const existing = await identityRepo.findExistingAssociation(sourceId, candidateId);
  if (existing) {
    return existing;
  }

  const source = await detectionRepo.findById(sourceId);
  const candidate = await detectionRepo.findById(candidateId);
  if (!source || !candidate) {
    const err = new Error('Source or candidate detection not found');
    err.status = 404;
    throw err;
  }

  const srcVec = parseEmbedding(source.reid_embedding);
  const candVec = parseEmbedding(candidate.reid_embedding);
  const reidSim = cosineSimilarity(srcVec, candVec);

  const plateSim = calculatePlateSimilarity(source.plate_text_normalized, candidate.plate_text_normalized);

  // Multi-signal composite score (weights: ReID 0.5, Plate 0.3, Class/Color 0.2)
  let attrMatch = 0.5;
  if (source.vehicle_class && candidate.vehicle_class && source.vehicle_class === candidate.vehicle_class) {
    attrMatch += 0.3;
  }
  if (source.vehicle_color && candidate.vehicle_color && source.vehicle_color === candidate.vehicle_color) {
    attrMatch += 0.2;
  }

  const compositeScore = reidSim * 0.5 + plateSim * 0.3 + attrMatch * 0.2;
  const decision = compositeScore >= 0.75 ? 'ACCEPTED' : compositeScore >= 0.5 ? 'PROPOSED' : 'FLAGGED';

  // Resolve or create the persistent global identity this association belongs to.
  // identity_associations.global_identity_id is a FOREIGN KEY to global_identities,
  // so a dangling UUID would violate the constraint — the identity row must exist
  // before the association referencing it can be inserted.
  // Only an accepted association can automatically join/assign a global identity.
  // PROPOSED/FLAGGED matches remain review candidates and must not merge timelines.
  let globalId = decision === 'ACCEPTED'
    ? (source.global_identity_id || candidate.global_identity_id || null)
    : null;
  if (!globalId && autoAssign && decision === 'ACCEPTED') {
    globalId = await resolveOrCreateGlobalIdentity(source, candidate);
  }

  const association = await identityRepo.createAssociation({
    id: crypto.randomUUID(),
    sourceDetectionId: sourceId,
    candidateDetectionId: candidateId,
    globalIdentityId: globalId || null,
    decision,
    decisionReason: `Composite threshold evaluation (reid=${reidSim.toFixed(2)}, plate=${plateSim.toFixed(2)}, attr=${attrMatch.toFixed(2)})`,
    reidSimilarity: Math.round(reidSim * 100) / 100,
    plateSimilarity: Math.round(plateSim * 100) / 100,
    compositeScore: Math.round(compositeScore * 100) / 100,
    evaluatedAt: new Date(),
  });

  return association;
}

/**
 * Resolves the global identity for a detection pair: reuses an existing plate-keyed
 * identity, reuses either detection's linked identity, or creates a new
 * global_identities row and links both detections to it.
 */
async function resolveOrCreateGlobalIdentity(source, candidate) {
  const sourceTime = new Date(source.timestamp);
  const candidateTime = new Date(candidate.timestamp);
  const firstSeen = sourceTime <= candidateTime ? sourceTime : candidateTime;
  const lastSeen = sourceTime >= candidateTime ? sourceTime : candidateTime;

  const plate = source.plate_text_normalized || candidate.plate_text_normalized;
  if (plate) {
    const plateIdentity = await identityRepo.findByLabel(`PLATE-${plate}`);
    if (plateIdentity) {
      await Promise.all([
        identityRepo.linkDetectionToIdentity(source.id, plateIdentity.id),
        identityRepo.linkDetectionToIdentity(candidate.id, plateIdentity.id),
      ]);
      return plateIdentity.id;
    }
  }

  const created = await identityRepo.createGlobalIdentity({
    label: plate ? `PLATE-${plate}` : `VID-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    primaryPlate: plate || null,
    plateConfidence: source.plate_confidence || candidate.plate_confidence || null,
    primaryVehicleType: source.vehicle_class || candidate.vehicle_class || null,
    primaryColor: source.vehicle_color || candidate.vehicle_color || null,
    firstSeenTimestamp: firstSeen,
    lastSeenTimestamp: lastSeen,
    detectionCount: 2,
  });

  await Promise.all([
    identityRepo.linkDetectionToIdentity(source.id, created.id),
    identityRepo.linkDetectionToIdentity(candidate.id, created.id),
  ]);
  return created.id;
}

async function reviewAssociation(id, { action }) {
  // CONFIRM/REJECT are human review actions recorded in review_status; the system
  // decision is updated so the "status" contract field reflects the review outcome.
  const mapping = action === 'CONFIRM'
    ? { decision: 'ACCEPTED', reviewStatus: 'CONFIRMED' }
    : action === 'REJECT'
      ? { decision: 'REJECTED', reviewStatus: 'REJECTED' }
      : { decision: 'FLAGGED', reviewStatus: 'FLAGGED' };
  const updated = await identityRepo.reviewAssociation(id, mapping);
  if (!updated) {
    const err = new Error(`Association not found with id: ${id}`);
    err.status = 404;
    throw err;
  }
  return updated;
}

async function reconstructTrajectory(globalIdentityId) {
  const identity = await identityRepo.findById(globalIdentityId);
  if (!identity) {
    const err = new Error(`Global identity not found: ${globalIdentityId}`);
    err.status = 404;
    throw err;
  }

  const detectionsPage = await identityRepo.findDetectionsByIdentity(globalIdentityId, { page: 0, size: 500 });
  const detections = detectionsPage.content;

  const parseCoordinate = (value, min, max) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const parseConfidence = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
  };

  const observations = detections.map(d => {
    const latitude = parseCoordinate(d.latitude, -90, 90);
    const longitude = parseCoordinate(d.longitude, -180, 180);
    return {
      detectionId: Number(d.id),
      cameraId: d.cameraId,
      cameraName: d.cameraName,
      latitude,
      longitude,
      hasCoordinates: latitude !== null && longitude !== null,
      timestamp: d.timestamp || null,
      confidence: parseConfidence(d.confidence),
      vehicleType: d.vehicleType,
      color: d.vehicleColor,
      evidencePath: d.evidencePath,
    };
  });

  const transitions = [];
  let totalDistanceKm = 0.0;
  let totalDurationMinutes = 0.0;
  let hasUnknownDistance = false;
  let hasUnknownDuration = false;

  for (let i = 0; i < observations.length - 1; i++) {
    const from = observations[i];
    const to = observations[i + 1];

    const hasCoordinates = from.hasCoordinates && to.hasCoordinates;
    const distKm = hasCoordinates
      ? haversineDistanceKm(from.latitude, from.longitude, to.latitude, to.longitude)
      : null;
    const elapsedMs = from.timestamp && to.timestamp
      ? new Date(to.timestamp).getTime() - new Date(from.timestamp).getTime()
      : NaN;
    const durationSec = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1000.0 : null;
    const speedKmh = distKm !== null && durationSec !== null
      ? calculateSpeedKmh(distKm, durationSec)
      : null;

    // Check road graph edge, but a road edge does not invent missing camera coordinates.
    const edge = await identityRepo.findCameraEdge(from.cameraId, to.cameraId);
    const isVerifiedRoad = Boolean(edge && edge.is_verified);
    const connectivityType = from.cameraId === to.cameraId
      ? 'SAME_CAMERA'
      : isVerifiedRoad
        ? 'VERIFIED_ROAD_EDGE'
        : hasCoordinates
          ? 'UNVERIFIED_GEODESIC'
          : 'UNKNOWN';

    transitions.push({
      fromCameraId: from.cameraId,
      toCameraId: to.cameraId,
      distanceKm: distKm === null ? null : Math.round(distKm * 100) / 100,
      durationMinutes: durationSec === null ? null : Math.round((durationSec / 60.0) * 10) / 10,
      impliedSpeedKmh: speedKmh === null ? null : Math.round(speedKmh * 10) / 10,
      connectivityType,
      feasibility: speedKmh === null ? 'FEASIBILITY_UNKNOWN' : speedKmh <= 120.0 ? 'FEASIBLE' : 'IMPOSSIBLE',
    });

    if (distKm === null) hasUnknownDistance = true;
    else totalDistanceKm += distKm;
    if (durationSec === null) hasUnknownDuration = true;
    else totalDurationMinutes += durationSec / 60.0;
  }

  return {
    globalIdentityId,
    label: identity.label,
    primaryPlate: identity.primaryPlate,
    observations,
    transitions,
    // Null means at least one transition lacks the source data required for a full total.
    totalDistanceKm: hasUnknownDistance ? null : Math.round(totalDistanceKm * 100) / 100,
    totalDurationMinutes: hasUnknownDuration ? null : Math.round(totalDurationMinutes * 10) / 10,
    unknownCoordinateTransitions: transitions.filter(t => t.distanceKm === null).length,
    unknownTimeTransitions: transitions.filter(t => t.durationMinutes === null).length,
  };
}

async function assessTrajectoryQuality(globalIdentityId) {
  const traj = await reconstructTrajectory(globalIdentityId);
  const count = traj.observations.length;
  const feasibleCount = traj.transitions.filter(t => t.feasibility === 'FEASIBLE').length;

  const completeness = Math.min(1.0, count / 5.0);
  const feasibilityRatio = traj.transitions.length > 0 ? feasibleCount / traj.transitions.length : 1.0;
  const overallQuality = (completeness * 0.4 + feasibilityRatio * 0.6);

  return {
    globalIdentityId,
    observationCount: count,
    transitionCount: traj.transitions.length,
    completenessScore: Math.round(completeness * 100) / 100,
    feasibilityScore: Math.round(feasibilityRatio * 100) / 100,
    overallQualityScore: Math.round(overallQuality * 100) / 100,
    qualityRating: overallQuality >= 0.8 ? 'HIGH' : overallQuality >= 0.5 ? 'MODERATE' : 'LOW',
  };
}

module.exports = {
  listIdentities: identityRepo.findAll,
  searchIdentity: identityRepo.search,
  getGlobalIdentity: identityRepo.findById,
  getIdentityDetections: identityRepo.findDetectionsByIdentity,
  getIdentityAssociations: identityRepo.findAssociationsByIdentity,
  associateDetections,
  reviewAssociation,
  reconstructTrajectory,
  assessTrajectoryQuality,
  calculatePlateSimilarity,
};
