/**
 * Analytics Service
 * Computes city-wide traffic intelligence metrics from stored detections and trajectories.
 */

const { query } = require('../../database/pool');

async function overview() {
  // 1. Camera Status Aggregation
  const camerasRes = await query(`
    SELECT status, COUNT(*) AS count
    FROM cameras
    GROUP BY status
  `);
  let totalCameras = 0;
  let camerasOnline = 0;
  let camerasProcessing = 0;
  let camerasOffline = 0;

  for (const row of camerasRes.rows) {
    const count = parseInt(row.count, 10);
    totalCameras += count;
    if (row.status === 'ONLINE' || row.status === 'STREAM_CONNECTED') {
      camerasOnline += count;
    } else if (row.status === 'PROCESSING') {
      camerasProcessing += count;
    } else {
      camerasOffline += count;
    }
  }

  // 2. Vehicle Counts
  const vehiclesCountRes = await query('SELECT COUNT(*) AS total FROM vehicles');
  const totalVehicles = parseInt(vehiclesCountRes.rows[0].total, 10);

  // 3. Detections Count
  const detectionsCountRes = await query('SELECT COUNT(*) AS total FROM vehicle_detections');
  const totalDetections = parseInt(detectionsCountRes.rows[0].total, 10);

  // 4. Vehicle Type Distribution
  const typeRes = await query(`
    SELECT vehicle_type AS "vehicleType", COUNT(*) AS count
    FROM vehicles
    WHERE vehicle_type IS NOT NULL
    GROUP BY vehicle_type
    ORDER BY count DESC
  `);
  const vehicleTypeDistribution = typeRes.rows.map(r => ({
    vehicleType: r.vehicleType,
    count: parseInt(r.count, 10),
  }));

  // 5. Hourly Detections
  const hourlyRes = await query(`
    SELECT EXTRACT(HOUR FROM timestamp) AS hour, COUNT(*) AS count
    FROM vehicle_detections
    GROUP BY hour
    ORDER BY hour ASC
  `);
  const detectionsByHour = hourlyRes.rows.map(r => ({
    hour: parseInt(r.hour, 10),
    count: parseInt(r.count, 10),
  }));

  // 6. Busiest Cameras
  const busiestRes = await query(`
    SELECT c.id AS "cameraId", c.name AS "cameraName", COUNT(d.id) AS count
    FROM vehicle_detections d
    JOIN cameras c ON d.camera_id = c.id
    GROUP BY c.id, c.name
    ORDER BY count DESC
    LIMIT 5
  `);
  const busiestCameras = busiestRes.rows.map(r => ({
    cameraId: r.cameraId,
    cameraName: r.cameraName,
    count: parseInt(r.count, 10),
  }));

  // Average only measured speed values. Never display a fixed/demo speed as a live metric.
  const speedRes = await query(`
    SELECT AVG(speed_kmh) AS average_speed, COUNT(speed_kmh) AS sample_count
    FROM vehicle_detections
    WHERE speed_kmh IS NOT NULL AND speed_kmh >= 0
  `);
  const averageObservedSpeedKmh = speedRes.rows[0].average_speed == null
    ? null
    : Number(speedRes.rows[0].average_speed);

  // Derive corridor counts only from detections linked to a persistent vehicle or global identity.
  // Plate-only/unlinked detections are excluded to avoid merging cloned or ambiguous plates.
  const transitionsRes = await query(`
    WITH ordered AS (
      SELECT
        COALESCE(global_identity_id::text, 'vehicle:' || vehicle_id::text) AS identity_key,
        camera_id,
        timestamp,
        LAG(camera_id) OVER (
          PARTITION BY COALESCE(global_identity_id::text, 'vehicle:' || vehicle_id::text)
          ORDER BY timestamp, id
        ) AS from_camera_id
      FROM vehicle_detections
      WHERE global_identity_id IS NOT NULL OR vehicle_id IS NOT NULL
    ), transitions AS (
      SELECT from_camera_id, camera_id AS to_camera_id
      FROM ordered
      WHERE from_camera_id IS NOT NULL AND from_camera_id <> camera_id
    )
    SELECT t.from_camera_id AS "fromCameraId", fc.name AS "fromCameraName",
           t.to_camera_id AS "toCameraId", tc.name AS "toCameraName", COUNT(*) AS count
    FROM transitions t
    LEFT JOIN cameras fc ON fc.id = t.from_camera_id
    LEFT JOIN cameras tc ON tc.id = t.to_camera_id
    GROUP BY t.from_camera_id, fc.name, t.to_camera_id, tc.name
    ORDER BY count DESC, t.from_camera_id, t.to_camera_id
  `);
  const topRoutes = transitionsRes.rows.map(r => ({
    fromCameraId: r.fromCameraId,
    fromCameraName: r.fromCameraName || r.fromCameraId,
    toCameraId: r.toCameraId,
    toCameraName: r.toCameraName || r.toCameraId,
    count: parseInt(r.count, 10),
  }));
  const sumByCamera = (field) => {
    const counts = new Map();
    for (const route of topRoutes) {
      const id = route[field];
      counts.set(id, (counts.get(id) || 0) + route.count);
    }
    return [...counts.entries()]
      .map(([cameraId, count]) => ({
        cameraId,
        cameraName: topRoutes.find(r => r[field] === cameraId)?.[field === 'fromCameraId' ? 'fromCameraName' : 'toCameraName'] || cameraId,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  };

  return {
    totalCameras,
    camerasOnline,
    camerasProcessing,
    camerasOffline,
    totalVehicles,
    totalDetections,
    vehicleTypeDistribution,
    detectionsByHour,
    busiestCameras,
    // Kept null for older clients: recorded point speeds are not transition speeds.
    averageTransitionSpeedKmh: null,
    averageObservedSpeedKmh,
    commonOrigins: sumByCamera('fromCameraId'),
    commonDestinations: sumByCamera('toCameraId'),
    topRoutes,
  };
}

module.exports = {
  overview,
};
