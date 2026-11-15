/**
 * Investigation Planner
 * Maps recognized intent and extracted entities into an explicit, validated step-by-step execution plan.
 * Emits clear clarification prompts if required entities are absent.
 */

const { INTENTS } = require('./intent-recognizer');

function createInvestigationPlan(intent, entities, caseId = null) {
  const scoped = (params) => caseId ? { ...params, caseId } : params;
  switch (intent) {
    case INTENTS.TRACE_VEHICLE: {
      if (!entities.plate) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Please specify the vehicle registration number plate you want to trace.',
        };
      }
      return {
        valid: true,
        intent,
        steps: [
          { tool: 'get_vehicle_trajectory', params: scoped({ plate: entities.plate }) },
          { tool: 'get_investigation_summary', params: scoped({ plate: entities.plate }) },
        ],
        targetPlate: entities.plate,
      };
    }

    case INTENTS.LAST_KNOWN_LOCATION: {
      if (!entities.plate) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Which vehicle do you want to find the last known location for? Please provide a number plate.',
        };
      }
      return {
        valid: true,
        intent,
        steps: [
          { tool: 'get_latest_vehicle_location', params: scoped({ plate: entities.plate }) },
        ],
        targetPlate: entities.plate,
      };
    }

    case INTENTS.FIND_SIGHTINGS: {
      if (!entities.plate) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Please specify the vehicle number plate to search for sightings.',
        };
      }
      return {
        valid: true,
        intent,
        steps: [
          {
            tool: 'get_vehicle_sightings',
            params: {
              ...scoped({ plate: entities.plate }),
              startTime: entities.startTime,
              endTime: entities.endTime,
            },
          },
        ],
        targetPlate: entities.plate,
      };
    }

    case INTENTS.NEARBY_CAMERAS: {
      const lat = Number(entities.latitude);
      const lon = Number(entities.longitude);
      if (entities.latitude == null || entities.longitude == null ||
          !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lon) || lon < -180 || lon > 180) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Please provide the search location as latitude and longitude. Place-name lookup is not configured, so I will not guess coordinates.',
        };
      }

      const radiusKm = entities.radiusKm == null ? 5 : Number(entities.radiusKm);
      if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Please provide a search radius greater than 0 and no more than 100 km.',
        };
      }
      return {
        valid: true,
        intent,
        steps: [
          {
            tool: 'find_nearby_cameras',
            params: { latitude: lat, longitude: lon, radiusKm },
          },
        ],
      };
    }

    case INTENTS.INVESTIGATION_SUMMARY: {
      if (!entities.plate) {
        return {
          valid: false,
          needsClarification: true,
          clarificationPrompt: 'Which vehicle would you like an investigation summary for? Please provide the number plate.',
        };
      }
      return {
        valid: true,
        intent,
        steps: [
          { tool: 'get_investigation_summary', params: scoped({ plate: entities.plate }) },
        ],
        targetPlate: entities.plate,
      };
    }

    case INTENTS.PROCESSING_STATUS: {
      return {
        valid: true,
        intent,
        steps: [
          { tool: 'get_processing_status', params: { videoUploadId: entities.videoUploadId || null } },
        ],
      };
    }

    default: {
      return {
        valid: false,
        needsClarification: true,
        clarificationPrompt: 'I can help you trace vehicles, locate last known sightings, reconstruct trajectories, search nearby cameras, or summarize investigation files. How can I assist you?',
      };
    }
  }
}

module.exports = {
  createInvestigationPlan,
};

