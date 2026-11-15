const cameraRepo = require('./camera.repository');

async function listCameras(req, res, next) {
  try {
    const mode = String(req.query.mode || 'all').toLowerCase();
    if (!['all', 'live', 'historic', 'hybrid'].includes(mode)) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'mode must be all, live, historic or hybrid' });
    }
    if (req.query.bbox !== undefined) {
      const values = String(req.query.bbox).split(',').map(Number);
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'bbox must be west,south,east,north numeric coordinates' });
      }
      const [west, south, east, north] = values;
      if (west < -180 || east > 180 || west >= east || south < -90 || north > 90 || south >= north) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'bbox must be a valid non-wrapping geographic extent' });
      }
      return res.json(await cameraRepo.findWithinBounds(mode, { west, south, east, north }));
    }
    return res.json(await cameraRepo.findAll(mode));
  } catch (err) {
    return next(err);
  }
}

async function getCamera(req, res, next) {
  try {
    const camera = await cameraRepo.findById(req.params.cameraId);
    if (!camera) return res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown camera: ' + req.params.cameraId });
    return res.json(camera);
  } catch (err) {
    return next(err);
  }
}

async function registerCamera(req, res, next) {
  try {
    const body = req.body || {};
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!id) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Camera id is required' });
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Valid latitude and longitude are required' });
    }
    const saved = await cameraRepo.create({
      id,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ('Camera ' + id),
      latitude,
      longitude,
      direction: typeof body.direction === 'string' ? body.direction.trim() : null,
      status: body.status || 'CONFIGURED',
      videoSource: body.videoSource || null,
    });
    return res.status(201).json(saved);
  } catch (err) {
    return next(err);
  }
}

async function nearbyCameras(req, res, next) {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm || 5);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180
      || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Valid lat, lon and radiusKm (0-100) are required' });
    }
    return res.json(await cameraRepo.findNearby(lat, lon, radiusKm));
  } catch (err) {
    return next(err);
  }
}

module.exports = { listCameras, getCamera, registerCamera, nearbyCameras };
