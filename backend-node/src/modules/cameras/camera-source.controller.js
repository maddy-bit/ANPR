const service = require('./camera-source.service');

async function listSources(req, res, next) {
  try {
    return res.json(await service.listSources());
  } catch (err) {
    return next(err);
  }
}

async function createSource(req, res, next) {
  try {
    const source = await service.createSource(req.body);
    return res.status(201).json(source);
  } catch (err) {
    return res.status(400).json({
      error: 'INVALID_SOURCE',
      message: err.message,
    });
  }
}

async function quickImportSource(req, res, next) {
  try {
    const result = await service.quickImportSource(req.body || {});
    return res.status(result.alreadyRegistered ? 200 : 201).json(result);
  } catch (err) {
    return res.status(422).json({
      error: 'CAMERA_API_IMPORT_FAILED',
      message: err.message,
    });
  }
}

async function syncSource(req, res, next) {
  try {
    const result = await service.syncSource(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({
      error: 'SOURCE_SYNC_FAILED',
      message: err.message,
    });
  }
}

async function updateSource(req, res, next) {
  try {
    const enabled = req.body && req.body.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'enabled must be a boolean' });
    }
    return res.json(await service.setSourceEnabled(req.params.id, enabled));
  } catch (err) {
    if (err.message === 'Camera source was not found') {
      return res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    }
    return next(err);
  }
}

module.exports = {
  listSources,
  createSource,
  quickImportSource,
  syncSource,
  updateSource,
};
