const ALLOWED_COUNTRY = 'IN';

function valueAt(object, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (/^\d+$/.test(key)) return value[Number(key)];
    return value[key];
  }, object);
}

function normalizeCountry(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'IN' || normalized === 'IND' || normalized === 'INDIA') return 'IN';
  return normalized.length === 2 ? normalized : null;
}

function validCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function safeHttpUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    for (const key of parsed.searchParams.keys()) {
      if (/(api.?key|access.?token|token|secret|password|auth)/i.test(key)) return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function explicitBoolean(record, keys) {
  for (const key of keys) {
    if (record[key] === true || record[key] === 1 || record[key] === 'true') return true;
    if (record[key] === false || record[key] === 0 || record[key] === 'false') return false;
  }
  return false;
}

function classifyFeed(feedType, streamUrl, properties) {
  const raw = String(feedType || '').trim().toLowerCase();
  const url = String(streamUrl || '').toLowerCase();
  let type = 'UNKNOWN';

  if (['m3u8', 'hls', 'application/vnd.apple.mpegurl'].includes(raw) || url.includes('.m3u8')) {
    type = 'HLS';
  } else if (['image', 'jpg', 'jpeg', 'snapshot'].includes(raw) || /\.(jpg|jpeg|png|webp)(\?|$)/.test(url)) {
    type = 'IMAGE';
  } else if (['mjpeg', 'motion-jpeg', 'multipart/x-mixed-replace'].includes(raw) || url.includes('mjpeg')) {
    type = 'MJPEG';
  } else if (['mp4', 'video/mp4'].includes(raw) || /\.mp4(\?|$)/.test(url)) {
    type = 'MP4';
  } else if (['embed', 'youtube', 'player', 'agency-player'].includes(raw)) {
    type = 'EMBED';
  } else if (raw === 'dynamic') {
    type = 'DYNAMIC';
  }

  const declaredLive = explicitBoolean(properties, ['is_live', 'live', 'live_capable']);
  const declaredArchive = explicitBoolean(properties, ['archive_available', 'has_archive', 'recorded_archive'])
    || Boolean(properties.archive_url || properties.archive_api_url);

  return {
    type,
    liveVideo: type === 'HLS' || type === 'MJPEG' || (type === 'DYNAMIC' && declaredLive),
    liveSnapshot: type === 'IMAGE' || (type === 'DYNAMIC' && declaredLive && explicitBoolean(properties, ['snapshot'])),
    archiveAvailable: declaredArchive,
    externalPlayer: type === 'EMBED',
  };
}

function normalizeRecord(record, context) {
  const source = context || {};
  const props = record && record.properties ? record.properties : (record || {});
  const geometry = record && record.geometry ? record.geometry : null;
  const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  const longitude = validCoordinate(
    coordinates ? coordinates[0] : valueAt(props, source.mapping && source.mapping.longitude || 'longitude'),
    -180, 180
  );
  const latitude = validCoordinate(
    coordinates ? coordinates[1] : valueAt(props, source.mapping && source.mapping.latitude || 'latitude'),
    -90, 90
  );
  if (latitude === null || longitude === null) return null;
  // Broad India envelope (including island territories); this is a coarse scope guard, not a political boundary dataset.
  if (latitude < 5 || latitude > 38.8 || longitude < 67 || longitude > 98.8) return null;

  const mapping = source.mapping || {};
  const countryValue = valueAt(props, mapping.countryCode || 'country')
    || props.country_code || props.iso_country || props.countryCode;
  const countryCode = normalizeCountry(countryValue) || (source.allowCountryFallback ? source.countryScope : null);
  if (countryCode !== source.countryScope) return null;
  if (source.requireExplicitCountry && !normalizeCountry(countryValue)) return null;

  const externalId = valueAt(props, mapping.id || 'id') || props.camera_id || props.cameraId;
  if (externalId == null || !String(externalId).trim()) return null;

  const name = valueAt(props, mapping.name || 'name') || props.label || String(externalId);
  const streamValue = valueAt(props, mapping.streamUrl || 'stream')
    || props.stream_url || props.url || props.video_url;
  const streamUrl = safeHttpUrl(streamValue);
  const pageUrl = safeHttpUrl(valueAt(props, mapping.pageUrl || 'page') || props.page || props.website);
  const archiveUrl = safeHttpUrl(valueAt(props, mapping.archiveUrl || 'archive_url') || props.archive_url || props.archive_api_url);
  const declaredType = valueAt(props, mapping.feedType || 'stype') || props.feed_type || props.feedType;
  const capabilities = classifyFeed(declaredType, streamUrl, props);
  const status = String(props.status || props.liveness || 'UNVERIFIED').trim().toUpperCase();
  const direction = props.direction == null ? null : String(props.direction).slice(0, 50);

  return {
    sourceCameraId: String(externalId).trim().slice(0, 255),
    sourceNetwork: String(props.src || props.network || '').trim().slice(0, 120) || null,
    name: String(valueAt(props, mapping.name || 'name') || name).trim().slice(0, 255),
    latitude,
    longitude,
    direction,
    streamUrl,
    archiveUrl,
    pageUrl,
    attribution: String(props.attr || props.attribution || source.attribution || '').trim().slice(0, 1000) || null,
    countryCode,
    region: String(props.region || props.state || '').trim().slice(0, 160) || null,
    place: String(props.place || props.city || '').trim().slice(0, 160) || null,
    feedType: capabilities.type,
    liveVideo: capabilities.liveVideo && Boolean(streamUrl),
    liveSnapshot: capabilities.liveSnapshot && Boolean(streamUrl),
    archiveAvailable: capabilities.archiveAvailable,
    externalPlayer: capabilities.externalPlayer && Boolean(pageUrl || streamUrl),
    sourceStatus: ['LIVE', 'DOWN', 'OFFLINE', 'UNAVAILABLE'].includes(status) ? status : 'UNVERIFIED',
    sourceUpdatedAt: null,
  };
}

function normalizeGeoJson(payload, context) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Public camera catalogue must be a GeoJSON FeatureCollection');
  }
  const records = [];
  const skipped = { missingCoordinates: 0, missingId: 0, outsideCountryScope: 0, invalid: 0 };
  for (const feature of payload.features) {
    const sourceContext = context || {};
    const normalized = normalizeRecord(feature, {
      ...sourceContext,
      requireExplicitCountry: true,
      allowCountryFallback: false,
      mapping: {
        id: 'id',
        name: 'name',
        countryCode: 'country',
        streamUrl: 'stream',
        archiveUrl: 'archive_url',
        feedType: 'stype',
        pageUrl: 'page',
        ...(sourceContext.mapping || {}),
      },
    });
    if (normalized) {
      records.push(normalized);
    } else {
      const props = feature && feature.properties ? feature.properties : {};
      const coords = feature && feature.geometry && feature.geometry.coordinates;
      if (!Array.isArray(coords) || validCoordinate(coords[1], -90, 90) === null || validCoordinate(coords[0], -180, 180) === null) {
        skipped.missingCoordinates += 1;
      } else if (valueAt(props, (context && context.mapping && context.mapping.id) || 'id') == null) {
        skipped.missingId += 1;
      } else if (normalizeCountry(valueAt(props, (context && context.mapping && context.mapping.countryCode) || 'country') || props.country_code) !== ALLOWED_COUNTRY) {
        skipped.outsideCountryScope += 1;
      } else {
        skipped.invalid += 1;
      }
    }
  }
  return { records, total: payload.features.length, skipped };
}

function normalizeJsonApi(payload, sourceConfig) {
  const config = sourceConfig || {};
  const mapping = config.mapping || {};
  const rootPath = config.itemsPath || 'cameras';
  // Allow APIs whose JSON response is a camera array at the document root.
  const items = Array.isArray(payload) ? payload : valueAt(payload, rootPath);
  if (!Array.isArray(items)) {
    throw new Error('Configured JSON API itemsPath did not resolve to an array');
  }
  const records = [];
  const skipped = { missingCoordinates: 0, missingId: 0, outsideCountryScope: 0, invalid: 0 };
  for (const item of items) {
    const normalized = normalizeRecord(item, {
      countryScope: 'IN',
      allowCountryFallback: false,
      requireExplicitCountry: true,
      mapping,
    });
    if (normalized) records.push(normalized);
    else skipped.invalid += 1;
  }
  return { records, total: items.length, skipped };
}

module.exports = {
  normalizeGeoJson,
  normalizeJsonApi,
  classifyFeed,
  normalizeRecord,
  normalizeCountry,
  safeHttpUrl,
  valueAt,
};
