/**
 * Entity & Parameter Extractor
 * Extracts number plates, timestamps, camera IDs, coordinates, and radii from natural language.
 */

const { normalize } = require('../../utils/plate-normalizer');

const PLATE_REGEX = /\b([A-Za-z]{2}\s*[-]?\s*\d{1,2}\s*[-]?\s*[A-Za-z]{0,3}\s*[-]?\s*\d{4})\b/i;
const CAMERA_REGEX = /\b(CAM[-_]?\d{1,4})\b/i;
const RADIUS_REGEX = /\b(\d+(?:\.\d+)?)\s*(?:km|kilometers|kilometer|kms)\b/i;

function extractEntities(text, conversationContext = {}) {
  const result = {
    plate: null,
    cameraId: null,
    latitude: null,
    longitude: null,
    radiusKm: null,
    startTime: null,
    endTime: null,
    requiresClarification: false,
    clarificationPrompt: null,
  };

  const lower = text.toLowerCase();

  // 1. Plate Extraction
  const plateMatch = text.match(PLATE_REGEX);
  if (plateMatch) {
    result.plate = normalize(plateMatch[1]);
  } else if (conversationContext && conversationContext.activePlate) {
    // Coreference resolution: "it", "its", "this car", "this vehicle", "that plate"
    if (/\b(it|its|this car|this vehicle|that car|that vehicle|the car|the vehicle)\b/i.test(text)) {
      result.plate = conversationContext.activePlate;
    }
  }

  // 2. Camera ID Extraction
  const camMatch = text.match(CAMERA_REGEX);
  if (camMatch) {
    result.cameraId = camMatch[1].toUpperCase().replace('_', '-');
  }

  // 3. Radius Extraction
  const radiusMatch = text.match(RADIUS_REGEX);
  if (radiusMatch) {
    result.radiusKm = parseFloat(radiusMatch[1]);
  }

  // Coordinate pair supplied by the investigator as latitude and longitude.
  // Keep coordinates absent when the request contains only a place name; do not
  // substitute a default city or infer a location from unrelated context.
  const coordinateMatch = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,/]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);
    if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
        Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
      result.latitude = latitude;
      result.longitude = longitude;
    }
  }

  // 4. Time Window Extraction
  const now = new Date();
  if (lower.includes('last 24 hours') || lower.includes('past 24 hours')) {
    result.startTime = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    result.endTime = now.toISOString();
  } else if (lower.includes('yesterday')) {
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    yesterday.setHours(0, 0, 0, 0);
    const endYesterday = new Date(yesterday);
    endYesterday.setHours(23, 59, 59, 999);
    result.startTime = yesterday.toISOString();
    result.endTime = endYesterday.toISOString();
  } else if (lower.includes('today')) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    result.startTime = today.toISOString();
    result.endTime = now.toISOString();
  } else if (lower.includes('last hour') || lower.includes('past hour')) {
    result.startTime = new Date(now.getTime() - 3600 * 1000).toISOString();
    result.endTime = now.toISOString();
  }

  return result;
}

module.exports = {
  extractEntities,
};

