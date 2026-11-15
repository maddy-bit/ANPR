const crypto = require('crypto');
const repo = require('./investigation.repository');
const vehicleRepo = require('../vehicles/vehicle.repository');
const plateNormalizer = require('../../utils/plate-normalizer');

function parseSearchScope(body, existing) {
  const data = {};
  const hasLat = Object.prototype.hasOwnProperty.call(body, 'searchCenterLat');
  const hasLon = Object.prototype.hasOwnProperty.call(body, 'searchCenterLon');
  if (hasLat !== hasLon) throw new Error('Search centre requires both latitude and longitude');

  if (hasLat && hasLon) {
    const lat = body.searchCenterLat == null ? null : Number(body.searchCenterLat);
    const lon = body.searchCenterLon == null ? null : Number(body.searchCenterLon);
    if ((lat === null) !== (lon === null)) throw new Error('Search centre requires both coordinates');
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error('Search centre latitude is invalid');
    if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) throw new Error('Search centre longitude is invalid');
    data.searchCenterLat = lat;
    data.searchCenterLon = lon;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'searchRadiusKm')) {
    const radius = body.searchRadiusKm == null || body.searchRadiusKm === '' ? null : Number(body.searchRadiusKm);
    if (radius !== null && (!Number.isFinite(radius) || radius <= 0 || radius > 100)) {
      throw new Error('Search radius must be greater than 0 and no more than 100 km');
    }
    data.searchRadiusKm = radius;
  }

  for (const [inputKey, outputKey] of [['searchStartAt', 'searchStartAt'], ['searchEndAt', 'searchEndAt']]) {
    if (!Object.prototype.hasOwnProperty.call(body, inputKey)) continue;
    const value = body[inputKey] == null || body[inputKey] === '' ? null : new Date(body[inputKey]);
    if (value && !Number.isFinite(value.getTime())) throw new Error(inputKey + ' must be a valid date');
    data[outputKey] = value ? value.toISOString() : null;
  }

  const start = Object.prototype.hasOwnProperty.call(data, 'searchStartAt')
    ? data.searchStartAt : (existing && existing.search_start_at);
  const end = Object.prototype.hasOwnProperty.call(data, 'searchEndAt')
    ? data.searchEndAt : (existing && existing.search_end_at);
  if (start && end && new Date(start) > new Date(end)) {
    throw new Error('Search start must be earlier than or equal to search end');
  }
  return data;
}

function mapCaseRecord(record) {
  if (!record) return null;
  const notes = Array.isArray(record.notes) ? record.notes : [];
  return {
    id: record.id,
    caseNumber: record.id,
    title: record.title,
    description: record.description || null,
    targetPlate: record.linked_plate || null,
    status: record.status,
    priority: record.priority,
    assignedOfficer: record.assigned_to || null,
    notes: notes.map((note) => ({
      timestamp: note.timestamp || null,
      officer: note.officer || note.author || 'Investigator',
      note: note.note || note.text || '',
    })),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    searchCenterLat: record.search_center_lat,
    searchCenterLon: record.search_center_lon,
    searchRadiusKm: record.search_radius_km,
    searchStartAt: record.search_start_at,
    searchEndAt: record.search_end_at,
  };
}

function mapSighting(record) {
  return {
    id: record.id,
    cameraId: record.cameraId,
    cameraName: record.cameraName,
    latitude: record.latitude,
    longitude: record.longitude,
    timestamp: record.timestamp,
    confidence: record.confidence,
    plateText: record.plateText,
    plateConfidence: record.plateConfidence,
    vehicleType: record.vehicleType,
    vehicleColor: record.vehicleColor,
    evidencePath: record.evidencePath,
    trackId: record.trackId,
    videoUploadId: record.videoUploadId,
  };
}

async function listCases(req, res, next) {
  try {
    const { status, limit, offset } = req.query;
    const cases = await repo.findAll({
      status,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: Math.max(parseInt(offset, 10) || 0, 0),
    });
    return res.json(cases.map(mapCaseRecord));
  } catch (err) {
    return next(err);
  }
}

async function getCase(req, res, next) {
  try {
    const caseItem = await repo.findById(req.params.id);
    if (!caseItem) return res.status(404).json({ error: 'NOT_FOUND', message: 'Investigation case not found' });
    let sightings = [];
    if (caseItem.linked_plate) sightings = await vehicleRepo.findDetectionsByPlate(plateNormalizer.normalize(caseItem.linked_plate));
    return res.json({
      ...mapCaseRecord(caseItem),
      sightings: sightings.map(mapSighting),
    });
  } catch (err) {
    return next(err);
  }
}

async function createCase(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Case title is required' });
    }
    const scope = parseSearchScope(body, null);
    if (scope.searchCenterLat != null && scope.searchRadiusKm == null) {
      scope.searchRadiusKm = 10;
    }
    const id = 'CASE-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const rawLinkedPlate = body.linkedPlate || body.targetPlate || null;
    const normalizedLinkedPlate = rawLinkedPlate ? plateNormalizer.normalize(String(rawLinkedPlate)) : '';
    const linkedPlate = normalizedLinkedPlate || null;
    const newCase = await repo.create({
      id,
      title: body.title.trim(),
      description: body.description,
      priority: body.priority || 'MEDIUM',
      assignedTo: body.assignedTo || body.assignedOfficer || 'Authorized Investigator',
      linkedPlate,
      searchCenterLat: scope.searchCenterLat ?? null,
      searchCenterLon: scope.searchCenterLon ?? null,
      searchRadiusKm: scope.searchRadiusKm ?? null,
      searchStartAt: scope.searchStartAt || null,
      searchEndAt: scope.searchEndAt || null,
      notes: [{
        author: body.assignedTo || body.assignedOfficer || 'System',
        text: 'Investigation case opened.',
        timestamp: new Date().toISOString(),
      }],
    });
    return res.status(201).json(mapCaseRecord(newCase));
  } catch (err) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
}

async function updateCase(req, res, next) {
  try {
    const existing = await repo.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Investigation case not found' });
    const updates = { ...req.body };
    Object.assign(updates, parseSearchScope(req.body || {}, existing));
    if (Object.prototype.hasOwnProperty.call(updates, 'targetPlate')
      || Object.prototype.hasOwnProperty.call(updates, 'linkedPlate')) {
      const rawPlate = Object.prototype.hasOwnProperty.call(updates, 'linkedPlate')
        ? updates.linkedPlate
        : updates.targetPlate;
      const normalizedPlate = rawPlate ? plateNormalizer.normalize(String(rawPlate)) : '';
      updates.linkedPlate = normalizedPlate || null;
      delete updates.targetPlate;
    }
    const updated = await repo.update(req.params.id, updates);
    return res.json(mapCaseRecord(updated));
  } catch (err) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
}

async function addNote(req, res, next) {
  try {
    const caseItem = await repo.findById(req.params.id);
    if (!caseItem) return res.status(404).json({ error: 'NOT_FOUND', message: 'Investigation case not found' });
    const existingNotes = Array.isArray(caseItem.notes) ? caseItem.notes : [];
    existingNotes.push({
      author: req.body.author || req.body.officer || 'Investigator',
      text: req.body.text || req.body.note || '',
      timestamp: new Date().toISOString(),
    });
    return res.json(mapCaseRecord(await repo.update(req.params.id, { notes: existingNotes })));
  } catch (err) {
    return next(err);
  }
}

module.exports = { listCases, getCase, createCase, updateCase, addNote };
