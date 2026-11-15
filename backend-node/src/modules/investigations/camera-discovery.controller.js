const investigationRepo = require('./investigation.repository');
const discoveryService = require('../cameras/camera-discovery.service');

async function cameraCandidates(req, res, next) {
  try {
    const caseItem = await investigationRepo.findById(req.params.id);
    if (!caseItem) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Investigation case not found' });
    }

    const detectionId = Number(req.body && req.body.detectionId);
    const radiusKm = Number((req.body && req.body.radiusKm) || 10);
    if (!Number.isSafeInteger(detectionId) || detectionId <= 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'A persisted detectionId is required' });
    }
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'radiusKm must be greater than 0 and no more than 100' });
    }

    const result = await discoveryService.findCandidatesForCase(caseItem, detectionId, radiusKm);
    return res.json(result);
  } catch (err) {
    if (err.message.includes('selected detection') || err.message.includes('outside the investigation time window')
      || err.message.includes('outside the investigation geographic scope')
      || err.message.includes('Configure the case centre')
      || err.message.includes('Link a target vehicle registration number')) {
      return res.status(400).json({ error: 'INVALID_INVESTIGATION_SIGHTING', message: err.message });
    }
    return next(err);
  }
}

module.exports = { cameraCandidates };
