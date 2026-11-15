const { query } = require('../../database/pool');
const plateNormalizer = require('../../utils/plate-normalizer');

async function findCandidatesForCase(caseItem, detectionId, radiusKm) {
  if (!caseItem.linked_plate || !String(caseItem.linked_plate).trim()) {
    throw new Error('Link a target vehicle registration number to the case before camera discovery');
  }
  if (caseItem.search_center_lat == null || caseItem.search_center_lon == null
    || caseItem.search_radius_km == null || !caseItem.search_start_at || !caseItem.search_end_at) {
    throw new Error('Configure the case centre, radius and complete start/end time window before camera discovery');
  }

  const detectionResult = await query(
    'SELECT d.id, d.camera_id AS "cameraId", d.timestamp, d.latitude, d.longitude, ' +
    'd.plate_text_normalized AS "plateText", c.name AS "cameraName", ' +
    'ST_Distance(d.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS "caseDistanceMeters" ' +
    'FROM vehicle_detections d JOIN cameras c ON c.id = d.camera_id WHERE d.id = $1',
    [detectionId, caseItem.search_center_lon, caseItem.search_center_lat]
  );
  const detection = detectionResult.rows[0];
  if (!detection) throw new Error('The selected detection does not exist');
  if (Number(detection.caseDistanceMeters) > Number(caseItem.search_radius_km) * 1000) {
    throw new Error('The selected detection is outside the investigation geographic scope');
  }

  if (caseItem.linked_plate) {
    const casePlate = plateNormalizer.normalize(caseItem.linked_plate);
    const detectionPlate = plateNormalizer.normalize(detection.plateText || '');
    if (!detectionPlate || casePlate !== detectionPlate) {
      throw new Error('The selected detection does not match the vehicle linked to this investigation');
    }
  }

  const observedAt = new Date(detection.timestamp);
  if (observedAt < new Date(caseItem.search_start_at) || observedAt > new Date(caseItem.search_end_at)) {
    throw new Error('The selected detection is outside the investigation time window');
  }

  const boundedRadiusKm = Math.min(
    Number.isFinite(Number(caseItem.search_radius_km)) && Number(caseItem.search_radius_km) > 0
      ? Number(caseItem.search_radius_km)
      : radiusKm,
    radiusKm,
    100
  );
  const radiusMeters = boundedRadiusKm * 1000;
  const hasCaseCenter = Number.isFinite(Number(caseItem.search_center_lat))
    && Number.isFinite(Number(caseItem.search_center_lon))
    && caseItem.search_center_lat !== null
    && caseItem.search_center_lon !== null;

  const params = [
    detection.longitude,
    detection.latitude,
    detection.cameraId,
    radiusMeters,
    hasCaseCenter,
    hasCaseCenter ? caseItem.search_center_lon : 0,
    hasCaseCenter ? caseItem.search_center_lat : 0,
    (Number(caseItem.search_radius_km) || boundedRadiusKm) * 1000,
  ];

  const result = await query(
    'WITH RECURSIVE verified_edges AS (' +
    ' SELECT from_camera_id AS from_id, to_camera_id AS to_id, road_distance_meters, ' +
    ' min_travel_time_sec, max_travel_time_sec, road_name FROM camera_edges WHERE is_verified = TRUE ' +
    ' UNION ' +
    ' SELECT to_camera_id AS from_id, from_camera_id AS to_id, road_distance_meters, ' +
    ' min_travel_time_sec, max_travel_time_sec, road_name FROM camera_edges WHERE is_verified = TRUE AND is_bidirectional = TRUE' +
    '), route_walk AS (' +
    ' SELECT $3::varchar AS camera_id, 0::integer AS hops, ARRAY[$3::varchar] AS path, ' +
    ' 0::double precision AS road_distance_meters, 0::double precision AS min_travel_time_sec, ' +
    ' 0::double precision AS max_travel_time_sec, NULL::varchar AS road_name ' +
    ' UNION ALL ' +
    ' SELECT edge.to_id, walk.hops + 1, walk.path || edge.to_id, ' +
    ' CASE WHEN walk.road_distance_meters IS NULL OR edge.road_distance_meters IS NULL THEN NULL ' +
    ' ELSE walk.road_distance_meters + edge.road_distance_meters END, ' +
    ' CASE WHEN walk.min_travel_time_sec IS NULL OR edge.min_travel_time_sec IS NULL THEN NULL ' +
    ' ELSE walk.min_travel_time_sec + edge.min_travel_time_sec END, ' +
    ' CASE WHEN walk.max_travel_time_sec IS NULL OR edge.max_travel_time_sec IS NULL THEN NULL ' +
    ' ELSE walk.max_travel_time_sec + edge.max_travel_time_sec END, edge.road_name ' +
    ' FROM route_walk walk JOIN verified_edges edge ON edge.from_id = walk.camera_id ' +
    ' WHERE walk.hops < 5 AND NOT edge.to_id = ANY(walk.path)' +
    '), ranked_routes AS (' +
    ' SELECT DISTINCT ON (camera_id) camera_id, hops, road_distance_meters, ' +
    ' min_travel_time_sec, max_travel_time_sec, road_name FROM route_walk WHERE hops > 0 ' +
    ' ORDER BY camera_id, hops ASC, road_distance_meters NULLS LAST' +
    ') ' +
    'SELECT c.id, c.name, c.latitude, c.longitude, c.direction, c.source_type AS "sourceType", ' +
    "c.source_name AS \"sourceName\", c.feed_type AS \"feedType\", " +
    "CASE WHEN c.source_type = 'GOVERNMENT_API' THEN NULL ELSE c.stream_url END AS \"streamUrl\", " +
    "c.page_url AS \"pageUrl\", c.attribution, c.live_video AS \"liveVideo\", " +
    'c.live_snapshot AS "liveSnapshot", c.external_player AS "externalPlayer", ' +
    'c.source_status AS "sourceStatus", ' +
    'ST_Distance(c.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "geodesicDistanceMeters", ' +
    '(route.camera_id IS NOT NULL) AS "verifiedCameraEdge", route.road_name AS "roadName", ' +
    'route.road_distance_meters AS "roadDistanceMeters", route.min_travel_time_sec AS "minTravelTimeSeconds", ' +
    'route.max_travel_time_sec AS "maxTravelTimeSeconds", route.hops AS "routeHops" ' +
    'FROM cameras c LEFT JOIN ranked_routes route ON route.camera_id = c.id ' +
    "WHERE c.id <> $3 AND (c.live_video = TRUE OR c.live_snapshot = TRUE OR c.external_player = TRUE) " +
    "AND COALESCE(c.source_status, 'UNKNOWN') NOT IN ('DOWN','OFFLINE','UNAVAILABLE','STALE') " +
    'AND (route.camera_id IS NOT NULL OR ST_DWithin(c.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)) ' +
    'AND ($5::boolean = FALSE OR ST_DWithin(c.location, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8)) ' +
    'ORDER BY CASE WHEN route.camera_id IS NOT NULL THEN 0 ELSE 1 END, ' +
    'CASE WHEN c.live_video = TRUE OR c.live_snapshot = TRUE THEN 0 ELSE 1 END, ' +
    'route.hops ASC NULLS LAST, "geodesicDistanceMeters" ASC LIMIT 100',
    params
  );

  const candidates = result.rows.map((camera) => {
    const verified = camera.verifiedCameraEdge === true;
    const processable = camera.liveVideo === true || camera.liveSnapshot === true;
    return {
      ...camera,
      routeRelation: verified ? 'VERIFIED_ROUTE_NETWORK' : 'NEARBY_ALTERNATIVE_UNVERIFIED',
      // Feed capability is catalog metadata only. This endpoint never probes a
      // source, verifies operator authorization, or dispatches inference.
      processingCapability: processable ? 'FEED_METADATA_ONLY' : 'EXTERNAL_PLAYER_ONLY',
      investigationStage: verified ? 'PRIMARY_VERIFIED_ROUTE' : 'FALLBACK_NEARBY',
      estimatedArrivalWindowSeconds: verified && camera.minTravelTimeSeconds != null && camera.maxTravelTimeSeconds != null
        ? { minimum: camera.minTravelTimeSeconds, maximum: camera.maxTravelTimeSeconds }
        : null,
      priority: verified ? 'ROUTE_FIRST' : 'FALLBACK_REVIEW',
    };
  });

  const primaryCount = candidates.filter((camera) => camera.investigationStage === 'PRIMARY_VERIFIED_ROUTE').length;
  const fallbackCount = candidates.length - primaryCount;

  return {
    investigationId: caseItem.id,
    seedDetectionId: detection.id,
    seedCameraId: detection.cameraId,
    observedAt: observedAt.toISOString(),
    radiusKm: boundedRadiusKm,
    candidateStages: {
      primary: { name: 'PRIMARY_VERIFIED_ROUTE', candidateCount: primaryCount },
      fallback: { name: 'FALLBACK_NEARBY', candidateCount: fallbackCount },
      expansionPolicy: 'Fallback candidates are returned after verified-route candidates for operator review; no live detection result is produced by this endpoint.',
    },
    candidates,
    warnings: [
      'Only camera_edges rows explicitly marked verified are treated as route connections.',
      'Nearby alternatives are geographic candidates, not proof that a camera covers the road.',
      'Feed capability is imported metadata only; no feed is opened, authorized, health-checked, or processed by this discovery request.',
      'Candidate ordering is a routing tier, not a calibrated probability that the vehicle will pass a camera.',
    ],
  };
}

module.exports = { findCandidatesForCase };
