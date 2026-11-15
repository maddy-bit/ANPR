/**
 * Geographic & Spatial Mathematics Utility
 * Implements Haversine distance and kinematic speed calculation.
 */

const EARTH_RADIUS_KM = 6371.0;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180.0;
}

/**
 * Calculates great-circle distance between two (lat, lon) coordinates in kilometers.
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Calculates implied travel speed in km/h between two sightings.
 */
function calculateSpeedKmh(distanceKm, durationSeconds) {
  if (durationSeconds <= 0) return 0.0;
  const hours = durationSeconds / 3600.0;
  return distanceKm / hours;
}

/**
 * Calculates great-circle distance between two (lat, lon) coordinates in meters.
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  return haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000.0;
}

/**
 * Calculates implied travel speed in km/h given distance in meters and duration in seconds.
 */
function computeKinematicSpeedKmh(distanceMeters, durationSeconds) {
  if (durationSeconds <= 0) return 0.0;
  const distanceKm = distanceMeters / 1000.0;
  return calculateSpeedKmh(distanceKm, durationSeconds);
}

module.exports = {
  EARTH_RADIUS_KM,
  haversineDistanceKm,
  haversineDistanceMeters,
  calculateSpeedKmh,
  computeKinematicSpeedKmh,
};
