/**
 * Global Identity Controller
 */

const identityService = require('./identity.service');

async function listIdentities(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const size = parseInt(req.query.size, 10) || 20;
    const result = await identityService.listIdentities({ page, size });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function searchIdentity(req, res, next) {
  try {
    const query = req.query.query;
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Search query cannot be blank' });
    }
    const result = await identityService.searchIdentity(query.trim());
    if (!result) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `No global identity found matching '${query}'` });
    }
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function getIdentity(req, res, next) {
  try {
    const identity = await identityService.getGlobalIdentity(req.params.id);
    if (!identity) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `Global identity not found: ${req.params.id}` });
    }
    return res.json(identity);
  } catch (err) {
    return next(err);
  }
}

async function getIdentityDetections(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const size = parseInt(req.query.size, 10) || 20;
    const result = await identityService.getIdentityDetections(req.params.id, { page, size });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function getIdentityAssociations(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 0;
    const size = parseInt(req.query.size, 10) || 20;
    const result = await identityService.getIdentityAssociations(req.params.id, { page, size });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function associate(req, res, next) {
  try {
    const { sourceDetectionId, candidateDetectionId, autoAssign } = req.body;
    const result = await identityService.associateDetections(
      Number(sourceDetectionId),
      Number(candidateDetectionId),
      Boolean(autoAssign)
    );
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function resolveAssociation(req, res, next) {
  try {
    const result = await identityService.reviewAssociation(req.params.id, req.body);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function getTrajectory(req, res, next) {
  try {
    const result = await identityService.reconstructTrajectory(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function getTrajectoryQuality(req, res, next) {
  try {
    const result = await identityService.assessTrajectoryQuality(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listIdentities,
  searchIdentity,
  getIdentity,
  getIdentityDetections,
  getIdentityAssociations,
  associate,
  resolveAssociation,
  getTrajectory,
  getTrajectoryQuality,
};
