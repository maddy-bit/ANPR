/**
 * Intent Recognizer
 * Classifies natural-language investigation user inputs into structured investigation intents.
 */

const INTENTS = {
  TRACE_VEHICLE: 'TRACE_VEHICLE',
  LAST_KNOWN_LOCATION: 'LAST_KNOWN_LOCATION',
  FIND_SIGHTINGS: 'FIND_SIGHTINGS',
  NEARBY_CAMERAS: 'NEARBY_CAMERAS',
  COMPARE_VEHICLES: 'COMPARE_VEHICLES',
  INVESTIGATION_SUMMARY: 'INVESTIGATION_SUMMARY',
  PROCESSING_STATUS: 'PROCESSING_STATUS',
  UNKNOWN: 'UNKNOWN',
};

const INVESTIGATION_MODES = {
  HISTORIC: 'HISTORIC',
  LIVE: 'LIVE',
  HYBRID: 'HYBRID',
};

function recognizeInvestigationMode(text) {
  const lower = String(text || '').toLowerCase();
  if (/\b(hybrid|both live and histor(?:ic|ical)|histor(?:ic|ical) and live)\b/i.test(lower)) {
    return INVESTIGATION_MODES.HYBRID;
  }
  if (/\b(live|real[ -]?time|right now|currently)\b/i.test(lower)) {
    return INVESTIGATION_MODES.LIVE;
  }
  return INVESTIGATION_MODES.HISTORIC;
}

function recognizeIntent(text) {
  const lower = text.toLowerCase();

  if (/\b(last seen|last known location|where was|latest location|where is)\b/i.test(lower)) {
    return INTENTS.LAST_KNOWN_LOCATION;
  }

  if (/\b(trace|route|trajectory|track|path|journey|follow)\b/i.test(lower)) {
    return INTENTS.TRACE_VEHICLE;
  }

  if (/\b(sightings|detected|detections|captured|spotted|seen at|seen by)\b/i.test(lower)) {
    return INTENTS.FIND_SIGHTINGS;
  }

  if (/\b(nearby cameras|cameras\s+(?:are\s+)?near|surrounding cameras|cameras in radius)\b/i.test(lower)) {
    return INTENTS.NEARBY_CAMERAS;
  }

  if (/\b(compare|same vehicle|match sightings|similarity)\b/i.test(lower)) {
    return INTENTS.COMPARE_VEHICLES;
  }

  if (/\b(summary|summarize|profile|history of|overview of)\b/i.test(lower)) {
    return INTENTS.INVESTIGATION_SUMMARY;
  }

  if (/\b(processing status|finished processing|video status|job status|run status)\b/i.test(lower)) {
    return INTENTS.PROCESSING_STATUS;
  }

  return INTENTS.UNKNOWN;
}

module.exports = {
  INTENTS,
  recognizeIntent,
  INVESTIGATION_MODES,
  recognizeInvestigationMode,
};
