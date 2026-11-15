const { randomUUID, createHash } = require('crypto');
const config = require('../../config/env');
const logger = require('../../config/logger');
const repository = require('./camera-source.repository');
const adapter = require('./camera-source.adapter');
const security = require('./camera-source.security');

const MAX_CATALOG_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
let syncTimer = null;
let startupTimer = null;
let syncInProgress = false;

function cleanKey(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return key.slice(0, 90);
}

function validateSourceInput(input) {
  const body = input || {};
  const name = String(body.name || '').trim();
  const sourceType = String(body.sourceType || '').toUpperCase();
  const sourceKey = cleanKey(body.sourceKey || name);
  const endpointUrl = String(body.endpointUrl || '').trim();
  const sourceAdapter = String(body.adapter || 'JSON_API').toUpperCase();
  const authType = String(body.authType || 'NONE').toUpperCase();

  if (!name || name.length > 255) throw new Error('Source name is required (maximum 255 characters)');
  if (!sourceKey) throw new Error('A stable source key is required');
  if (!['PUBLIC_CATALOG', 'GOVERNMENT_API'].includes(sourceType)) throw new Error('Source type must be PUBLIC_CATALOG or GOVERNMENT_API');
  if (!['GODSEYE_GEOJSON', 'GEOJSON', 'JSON_API'].includes(sourceAdapter)) throw new Error('Unsupported source adapter');
  if (!['NONE', 'BEARER', 'API_KEY_HEADER', 'API_KEY_QUERY'].includes(authType)) throw new Error('Unsupported authentication type');
  if (endpointUrl.length > 2048) throw new Error('Source endpoint is too long');
  const parsed = new URL(endpointUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Source endpoint must use HTTPS without embedded credentials');
  for (const key of parsed.searchParams.keys()) {
    if (/(api.?key|access.?token|token|secret|password|auth)/i.test(key)) {
      throw new Error('Do not place credentials in the endpoint URL; use the encrypted authentication field');
    }
  }
  if (body.authValue && authType === 'NONE') throw new Error('Select an authentication type when providing an API credential');
  if (authType !== 'NONE' && (!body.authValue || String(body.authValue).length > 2048)) {
    throw new Error('A credential of 1–2048 characters is required for the selected authentication type');
  }
  const authHeaderName = String(body.authHeaderName || 'X-API-Key').trim();
  const authQueryName = String(body.authQueryName || 'api_key').trim();
  const validHeaderName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(authHeaderName);
  const validQueryName = /^[A-Za-z0-9_.-]+$/.test(authQueryName);
  if (!validHeaderName || !validQueryName) throw new Error('Authentication header/query parameter name is invalid');
  if (['host', 'content-length', 'connection', 'transfer-encoding'].includes(authHeaderName.toLowerCase())) {
    throw new Error('This HTTP header cannot be used for API authentication');
  }

  const configData = {
    itemsPath: String(body.itemsPath || 'cameras').slice(0, 160),
    // Stale marking is opt-in because a partial/filtered catalogue must never
    // make previously imported camera records disappear from live discovery.
    completeSnapshot: body.completeSnapshot === true,
    mapping: {},
  };
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  for (const key of ['id', 'name', 'latitude', 'longitude', 'streamUrl', 'archiveUrl', 'feedType', 'countryCode', 'pageUrl']) {
    const value = mapping[key];
    if (typeof value === 'string' && value.trim()) configData.mapping[key] = value.trim().slice(0, 160);
  }

  return {
    id: randomUUID(),
    sourceKey,
    name,
    sourceType,
    adapter: sourceAdapter,
    endpointUrl,
    attribution: String(body.attribution || '').trim().slice(0, 1000) || null,
    authType,
    authHeaderName: authHeaderName.slice(0, 100),
    authQueryName: authQueryName.slice(0, 100),
    encryptedSecret: body.authValue ? security.encryptSecret(body.authValue) : null,
    config: configData,
  };
}

async function readJsonResponse(response) {
  if (!response.ok) throw new Error('Upstream source returned HTTP ' + response.status);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  // Raw GitHub and some public GIS publishers serve GeoJSON as text/plain or octet-stream.
  // The JSON parser below remains the authoritative format validation.
  if (contentType.includes('text/html')) {
    throw new Error('Upstream returned an HTML page instead of a camera catalogue');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_CATALOG_BYTES) throw new Error('Camera catalogue exceeds the 40 MB safety limit');
  let buffer;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_CATALOG_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error('Camera catalogue exceeds the 40 MB safety limit');
        }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks, totalBytes);
    } catch (err) {
      await reader.cancel().catch(() => {});
      throw err;
    }
  } else {
    // Compatibility path for test doubles and non-streaming fetch implementations.
    buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_CATALOG_BYTES) throw new Error('Camera catalogue exceeds the 40 MB safety limit');
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('Upstream camera catalogue contains invalid JSON');
  }
}

function normalizedFieldKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findFieldPath(sample, aliases, prefix = '', depth = 0) {
  if (!sample || typeof sample !== 'object' || depth > 4) return null;
  const wanted = new Set(aliases.map(normalizedFieldKey));
  for (const [key, value] of Object.entries(sample)) {
    const path = prefix ? prefix + '.' + key : key;
    if (wanted.has(normalizedFieldKey(key)) && value !== null && value !== undefined && typeof value !== 'object') return path;
  }
  for (const [key, value] of Object.entries(sample)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findFieldPath(value, aliases, prefix ? prefix + '.' + key : key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findCameraArray(payload, prefix = '', depth = 0) {
  if (Array.isArray(payload)) return { path: prefix, items: payload };
  if (!payload || typeof payload !== 'object' || depth > 4) return null;

  const preferred = ['cameras', 'items', 'results', 'features', 'records', 'locations', 'data'];
  for (const preferredKey of preferred) {
    if (!Object.prototype.hasOwnProperty.call(payload, preferredKey)) continue;
    const value = payload[preferredKey];
    const nextPath = prefix ? prefix + '.' + preferredKey : preferredKey;
    if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) {
      return { path: nextPath, items: value };
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findCameraArray(value, nextPath, depth + 1);
      if (nested) return nested;
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (preferred.includes(key.toLowerCase())) continue;
    const nextPath = prefix ? prefix + '.' + key : key;
    if (Array.isArray(value) && value.some((item) => item && typeof item === 'object')) {
      return { path: nextPath, items: value };
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findCameraArray(value, nextPath, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function inferCameraApiDefinition(payload) {
  if (payload && payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    const sample = payload.features.find((feature) => feature && feature.properties)?.properties;
    if (!sample) throw new Error('GeoJSON catalogue contains no camera properties to inspect');
    const mapping = {
      id: findFieldPath(sample, ['id', 'camera_id', 'cameraId', 'uuid', 'code']),
      name: findFieldPath(sample, ['name', 'camera_name', 'cameraName', 'label', 'title']),
      countryCode: findFieldPath(sample, ['country', 'country_code', 'countryCode', 'iso_country', 'iso_a2', 'jurisdiction']),
      streamUrl: findFieldPath(sample, ['stream', 'stream_url', 'streamUrl', 'video_url', 'hls_url', 'url']),
      archiveUrl: findFieldPath(sample, ['archive_url', 'archiveUrl', 'recording_url']),
      feedType: findFieldPath(sample, ['feed_type', 'feedType', 'stype', 'protocol', 'format']),
      pageUrl: findFieldPath(sample, ['page', 'page_url', 'pageUrl', 'website']),
    };
    if (!mapping.id || !mapping.countryCode) {
      throw new Error('GeoJSON API must expose a camera ID and an explicit country field; quick import will not guess that records are in India');
    }
    return { adapter: 'GEOJSON', itemsPath: 'features', mapping };
  }

  const found = findCameraArray(payload);
  if (!found || !found.items.length) {
    throw new Error('API response is not a camera array or GeoJSON FeatureCollection');
  }
  const sample = found.items.find((item) => item && typeof item === 'object');
  const mapping = {
    id: findFieldPath(sample, ['id', 'camera_id', 'cameraId', 'source_camera_id', 'uuid', 'code']),
    name: findFieldPath(sample, ['name', 'camera_name', 'cameraName', 'label', 'title']),
    latitude: findFieldPath(sample, ['latitude', 'lat', 'lat_dd']),
    longitude: findFieldPath(sample, ['longitude', 'lon', 'lng', 'long', 'lon_dd']),
    countryCode: findFieldPath(sample, ['country', 'country_code', 'countryCode', 'iso_country', 'iso_a2', 'jurisdiction']),
    streamUrl: findFieldPath(sample, ['stream', 'stream_url', 'streamUrl', 'video_url', 'hls_url', 'url']),
    archiveUrl: findFieldPath(sample, ['archive_url', 'archiveUrl', 'recording_url']),
    feedType: findFieldPath(sample, ['feed_type', 'feedType', 'stype', 'protocol', 'format']),
    pageUrl: findFieldPath(sample, ['page', 'page_url', 'pageUrl', 'website']),
  };
  const required = ['id', 'latitude', 'longitude', 'countryCode'];
  const missing = required.filter((key) => !mapping[key]);
  if (missing.length) {
    throw new Error('Could not auto-detect required camera fields: ' + missing.join(', ') + '. The API must provide camera ID, latitude, longitude and an explicit country code.');
  }
  return { adapter: 'JSON_API', itemsPath: found.path, mapping };
}

function normalizeSourcePayload(source, payload) {
  if (source.adapter === 'GODSEYE_GEOJSON' || source.adapter === 'GEOJSON') {
    return adapter.normalizeGeoJson(payload, {
      countryScope: source.country_scope || 'IN',
      attribution: source.attribution,
      mapping: source.config && source.config.mapping ? source.config.mapping : {},
    });
  }
  return adapter.normalizeJsonApi(payload, source.config || {});
}

async function persistNormalizedSource(source, normalized, syncStartedAt) {
  const importedCount = await repository.upsertCameraRecords(source, normalized.records);
  const skippedCount = Object.values(normalized.skipped || {}).reduce(
    (sum, count) => sum + (Number.isFinite(Number(count)) ? Number(count) : 0),
    0
  );
  const completeSnapshot = Boolean(source.config && source.config.completeSnapshot === true);
  const canMarkStale = completeSnapshot && normalized.records.length > 0 && skippedCount === 0;
  const staleCount = canMarkStale
    ? await repository.markMissingSourceRecordsStale(source.id, syncStartedAt)
    : 0;
  const result = {
    sourceId: source.id,
    sourceKey: source.source_key,
    status: 'SUCCESS',
    importedCount,
    staleCount,
    staleMarking: canMarkStale ? 'APPLIED_COMPLETE_SNAPSHOT' : 'SKIPPED_NON_AUTHORITATIVE_SNAPSHOT',
    upstreamRecords: normalized.total,
    skipped: normalized.skipped,
    syncedAt: new Date().toISOString(),
  };
  await repository.updateSyncResult(source.id, {
    status: 'SUCCESS',
    importedCount,
    error: null,
  });
  return result;
}

async function quickImportSource(input) {
  const endpointUrl = String((input && input.endpointUrl) || '').trim();
  if (!endpointUrl || endpointUrl.length > 2048) {
    throw new Error('Paste a valid HTTPS camera catalogue API URL');
  }
  const endpoint = await security.assertSafeSourceUrl(endpointUrl);
  const sourceKey = cleanKey('API_' + endpoint.hostname + '_' + createHash('sha256').update(endpoint.toString()).digest('hex').slice(0, 10));

  const existing = await repository.findSourceByKey(sourceKey);
  if (existing) {
    const syncResult = await syncSource(existing.id);
    return { source: await listSources().then((items) => items.find((item) => item.id === existing.id) || null), ...syncResult, alreadyRegistered: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let payload;
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      headers: { Accept: 'application/geo+json, application/json;q=0.9' },
      redirect: 'error',
      signal: controller.signal,
    });
    payload = await readJsonResponse(response);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Camera catalogue API request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const inferred = inferCameraApiDefinition(payload);
  const name = String((input && input.name) || endpoint.hostname).trim().slice(0, 255);
  const source = validateSourceInput({
    name,
    sourceKey,
    sourceType: 'PUBLIC_CATALOG',
    adapter: inferred.adapter,
    endpointUrl: endpoint.toString(),
    attribution: endpoint.hostname,
    authType: 'NONE',
    itemsPath: inferred.itemsPath,
    mapping: inferred.mapping,
    completeSnapshot: false,
  });
  const sourceForNormalization = {
    ...source,
    source_key: source.sourceKey,
    source_type: source.sourceType,
    country_scope: 'IN',
  };
  const normalized = normalizeSourcePayload(sourceForNormalization, payload);
  if (!normalized.records.length) {
    throw new Error('API was reachable, but no valid India-scoped camera records were found. The API must include explicit country codes and valid coordinates.');
  }

  await repository.createSource(source);
  const saved = await repository.findSourceById(source.id);
  const syncResult = await persistNormalizedSource(saved, normalized, new Date());
  return {
    source: {
      id: saved.id,
      sourceKey: saved.source_key,
      name: saved.name,
      sourceType: saved.source_type,
      adapter: saved.adapter,
      endpointUrl: saved.endpoint_url,
      countryScope: saved.country_scope,
      enabled: saved.enabled,
      lastSyncStatus: 'SUCCESS',
    },
    ...syncResult,
    alreadyRegistered: false,
  };
}

async function syncSource(sourceId) {
  const source = await repository.findSourceById(sourceId);
  if (!source) throw new Error('Camera source was not found');
  if (!source.enabled) throw new Error('Camera source is disabled');

  let result;
  const syncStartedAt = new Date();
  try {
    const endpoint = await security.assertSafeSourceUrl(source.endpoint_url);
    const auth = security.buildAuth(endpoint, source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    let payload;
    try {
      response = await fetch(auth.url.toString(), {
        method: 'GET',
        headers: auth.headers,
        redirect: 'error',
        signal: controller.signal,
      });
      // Keep the abort timer active while the response body is consumed too.
      payload = await readJsonResponse(response);
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('Upstream catalogue request timed out');
      if (response) throw err;
      throw new Error('Unable to fetch the configured camera catalogue');
    } finally {
      clearTimeout(timeout);
    }
    let normalized;
    if (source.adapter === 'GODSEYE_GEOJSON' || source.adapter === 'GEOJSON') {
      normalized = adapter.normalizeGeoJson(payload, {
        countryScope: source.country_scope,
        attribution: source.attribution,
        mapping: source.config && source.config.mapping ? source.config.mapping : {},
      });
    } else {
      normalized = adapter.normalizeJsonApi(payload, source.config || {});
    }

    const importedCount = await repository.upsertCameraRecords(source, normalized.records);
    const skippedCount = Object.values(normalized.skipped || {}).reduce(
      (sum, count) => sum + (Number.isFinite(Number(count)) ? Number(count) : 0),
      0
    );
    const completeSnapshot = Boolean(source.config && source.config.completeSnapshot === true);
    // Only an explicitly authoritative, non-empty, fully-normalized snapshot
    // can stale unseen records. Empty or partially filtered feeds are not proof
    // that previously known cameras have disappeared.
    const canMarkStale = completeSnapshot && normalized.records.length > 0 && skippedCount === 0;
    const staleCount = canMarkStale
      ? await repository.markMissingSourceRecordsStale(source.id, syncStartedAt)
      : 0;
    result = {
      sourceId: source.id,
      sourceKey: source.source_key,
      status: 'SUCCESS',
      importedCount,
      staleCount,
      staleMarking: canMarkStale ? 'APPLIED_COMPLETE_SNAPSHOT' : 'SKIPPED_NON_AUTHORITATIVE_SNAPSHOT',
      upstreamRecords: normalized.total,
      skipped: normalized.skipped,
      syncedAt: new Date().toISOString(),
    };
    await repository.updateSyncResult(source.id, {
      status: 'SUCCESS',
      importedCount,
      error: null,
    });
    return result;
  } catch (err) {
    const message = err && err.message ? String(err.message).slice(0, 500) : 'Camera source sync failed';
    await repository.updateSyncResult(source.id, {
      status: 'FAILED',
      importedCount: 0,
      error: message,
    }).catch(() => {});
    throw new Error(message);
  }
}

async function listSources() {
  return repository.listSources();
}

async function createSource(input) {
  const source = validateSourceInput(input);
  await repository.createSource(source);
  return repository.findSourceById(source.id).then((saved) => ({
    id: saved.id,
    sourceKey: saved.source_key,
    name: saved.name,
    sourceType: saved.source_type,
    adapter: saved.adapter,
    endpointUrl: saved.endpoint_url,
    countryScope: saved.country_scope,
    attribution: saved.attribution,
    enabled: saved.enabled,
    authType: saved.auth_type,
    hasCredentials: Boolean(saved.auth_secret_ciphertext),
    lastSyncStatus: saved.last_sync_status,
  }));
}

async function setSourceEnabled(id, enabled) {
  const updated = await repository.setEnabled(id, enabled);
  if (!updated) throw new Error('Camera source was not found');
  return { id, enabled };
}

async function syncEnabledSources() {
  if (syncInProgress) return { status: 'SKIPPED', reason: 'A camera source sync is already running' };
  syncInProgress = true;
  const summary = { status: 'COMPLETED', sourcesAttempted: 0, sourcesSucceeded: 0, sourcesFailed: 0, results: [] };
  try {
    const sources = await repository.listEnabledSources();
    for (const source of sources) {
      summary.sourcesAttempted += 1;
      try {
        const result = await syncSource(source.id);
        summary.sourcesSucceeded += 1;
        summary.results.push(result);
      } catch (err) {
        summary.sourcesFailed += 1;
        summary.results.push({
          sourceId: source.id,
          sourceKey: source.source_key,
          status: 'FAILED',
          error: err.message,
        });
        logger.warn({ sourceKey: source.source_key, error: err.message }, 'Camera source synchronization failed');
      }
    }
    return summary;
  } finally {
    syncInProgress = false;
  }
}

function startCameraSourceSync() {
  if (syncTimer) return;
  const intervalMs = Math.max(6, config.cameraSources.refreshHours) * 60 * 60 * 1000;
  startupTimer = setTimeout(() => {
    syncEnabledSources().catch((err) => {
      logger.warn({ error: err.message }, 'Initial public camera catalogue sync could not run; apply V11 migration first');
    });
    syncTimer = setInterval(() => {
      syncEnabledSources().catch((err) => {
        logger.warn({ error: err.message }, 'Scheduled camera source sync failed');
      });
    }, intervalMs);
    if (syncTimer.unref) syncTimer.unref();
  }, 15000);
  if (startupTimer.unref) startupTimer.unref();
}

function stopCameraSourceSync() {
  if (startupTimer) clearTimeout(startupTimer);
  if (syncTimer) clearInterval(syncTimer);
  startupTimer = null;
  syncTimer = null;
}

module.exports = {
  validateSourceInput,
  inferCameraApiDefinition,
  quickImportSource,
  syncSource,
  listSources,
  createSource,
  setSourceEnabled,
  syncEnabledSources,
  startCameraSourceSync,
  stopCameraSourceSync,
};
