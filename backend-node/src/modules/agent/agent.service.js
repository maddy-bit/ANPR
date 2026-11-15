/**
 * Agentic AI Orchestrator & Natural Language Response Generator
 * Converts natural language requests into structured investigation outputs.
 */

const { recognizeIntent, recognizeInvestigationMode, INVESTIGATION_MODES, INTENTS } = require('./intent-recognizer');
const { extractEntities } = require('./entity-extractor');
const { createInvestigationPlan } = require('./investigation-planner');
const { executeTool } = require('./tool-registry');
const memory = require('./conversation-memory');
const investigationRepo = require('../investigations/investigation.repository');
const plateNormalizer = require('../../utils/plate-normalizer');
const logger = require('../../config/logger');

function formatObservedTime(value) {
  if (value == null || value === '') return 'UNKNOWN';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'UNKNOWN';
}

function formatConfidence(value, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'UNKNOWN';
}

function formatCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return 'UNKNOWN';
  return `Latitude ${latitude.toFixed(4)}, Longitude ${longitude.toFixed(4)}`;
}

async function processUserMessage({ message, conversationId, caseId = null, activeCaseId = null, activePlate = null, actor = null }) {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return {
      reply: 'Please ask an investigation question, such as tracing a vehicle by its plate.',
      conversationId: conversationId || null,
      structuredData: null,
    };
  }

  // Sessions are scoped per actor so one client cannot continue another
  // client's conversation by reusing its conversationId.
  const session = memory.getOrCreateSession(actor, conversationId);
  const selectedCaseId = caseId || activeCaseId || session.activeCaseId || null;
  if (selectedCaseId) {
    session.activeCaseId = selectedCaseId;
    memory.updateSession(actor, session.id, { activeCaseId: selectedCaseId });
  }
  const entities = extractEntities(message, {
    ...session,
    activePlate: activePlate || session.activePlate,
  });
  const intent = recognizeIntent(message);
  const mode = recognizeInvestigationMode(message);

  if (mode === INVESTIGATION_MODES.LIVE) {
    const reply = 'Live camera capture and real-time vehicle matching are not available in this deployment. The current system can search recorded-video results and historical sightings only; no live feed was opened or checked. Provide an authorized camera source and enable the live ingestion service before requesting live tracking.';
    memory.updateSession(actor, session.id, {
      message: { role: 'user', content: message, timestamp: new Date() },
    });
    memory.updateSession(actor, session.id, {
      message: { role: 'assistant', content: reply, timestamp: new Date() },
    });
    return {
      reply,
      conversationId: session.id,
      intent,
      mode,
      plan: null,
      structuredData: {
        type: 'MODE_STATUS',
        requestedMode: mode,
        status: 'UNAVAILABLE',
        availableMode: INVESTIGATION_MODES.HISTORIC,
      },
    };
  }

  const caseRequiredIntents = new Set([
    INTENTS.TRACE_VEHICLE,
    INTENTS.LAST_KNOWN_LOCATION,
    INTENTS.FIND_SIGHTINGS,
    INTENTS.INVESTIGATION_SUMMARY,
  ]);
  let caseItem = null;
  if (caseRequiredIntents.has(intent)) {
    if (!selectedCaseId) {
      const reply = 'Select an investigation case before searching vehicle records. Historical searches will be limited to that caseâ€™s target and configured time/geographic scope.';
      memory.updateSession(actor, session.id, {
        message: { role: 'user', content: message, timestamp: new Date() },
      });
      memory.updateSession(actor, session.id, {
        message: { role: 'assistant', content: reply, timestamp: new Date() },
      });
      return {
        reply,
        conversationId: session.id,
        intent,
        mode,
        plan: null,
        structuredData: { type: 'CASE_REQUIRED', status: 'NEEDS_CASE' },
      };
    }
    caseItem = await investigationRepo.findById(selectedCaseId);
    if (!caseItem) {
      const reply = 'The selected investigation case could not be found. Refresh the case list and choose an active case.';
      return {
        reply,
        conversationId: session.id,
        intent,
        mode,
        plan: null,
        structuredData: { type: 'CASE_STATUS', status: 'NOT_FOUND' },
      };
    }
    const casePlate = caseItem.linked_plate ? plateNormalizer.normalize(caseItem.linked_plate) : null;
    if (!casePlate) {
      const reply = 'Link a target registration number to this case before searching its vehicle records.';
      return {
        reply,
        conversationId: session.id,
        intent,
        mode,
        plan: null,
        structuredData: { type: 'CASE_STATUS', status: 'TARGET_REQUIRED', caseId: selectedCaseId },
      };
    }
    if (entities.plate && plateNormalizer.normalize(entities.plate) !== casePlate) {
      const reply = `This case is scoped to plate ${casePlate}. Select or update the case linked to the requested vehicle before searching.`;
      return {
        reply,
        conversationId: session.id,
        intent,
        mode,
        plan: null,
        structuredData: { type: 'CASE_TARGET_MISMATCH', status: 'NEEDS_CASE', caseId: selectedCaseId },
      };
    }
    entities.plate = casePlate;
  }

  const plan = createInvestigationPlan(intent, entities, selectedCaseId);

  // If clarification is needed, return immediate helpful guidance
  if (!plan.valid || plan.needsClarification) {
    const reply = plan.clarificationPrompt || 'Could you provide more details regarding the target vehicle or investigation parameters?';
    memory.updateSession(actor, session.id, {
      message: { role: 'user', content: message, timestamp: new Date() },
    });
    memory.updateSession(actor, session.id, {
      message: { role: 'assistant', content: reply, timestamp: new Date() },
    });
    return {
      reply,
      conversationId: session.id,
      intent,
      mode,
      plan: null,
      structuredData: null,
    };
  }

  // Update session active plate
  if (plan.targetPlate) {
    session.activePlate = plan.targetPlate;
  }

  // Execute plan steps safely
  const stepResults = {};
  for (const step of plan.steps) {
    try {
      stepResults[step.tool] = await executeTool(step.tool, step.params);
    } catch (err) {
      logger.error({ tool: step.tool, err: err.message }, 'Agent tool execution failed');
      stepResults[step.tool] = { error: err.message };
    }
  }

  // Synthesize natural-language explanation and structured artifacts
  let reply = '';
  let structuredData = null;

  switch (intent) {
    case INTENTS.TRACE_VEHICLE: {
      const traj = stepResults['get_vehicle_trajectory'];
      const summary = stepResults['get_investigation_summary'];

      if (!traj || !traj.found || traj.points.length === 0) {
        reply = `No recorded sightings found for vehicle plate **${plan.targetPlate}**. Verify the registration number or ensure footage has been uploaded and processed.`;
      } else {
        const pCount = traj.points.length;
        const distanceText = traj.totalDistanceKm == null
          ? 'an unknown distance because one or more camera coordinates are unavailable'
          : `an estimated **${traj.totalDistanceKm} km**`;
        const feasibilityText = traj.overallFeasible == null
          ? 'Travel feasibility could not be assessed because timestamp or coordinate data is incomplete.'
          : traj.overallFeasible
            ? 'All travel speeds are within plausible city limits.'
            : 'Warning: Speed anomalies detected between certain observation points.';
        const camList = summary && summary.camerasVisited ? summary.camerasVisited.join(' âž” ') : 'Multiple cameras';
        reply = `Vehicle **${plan.targetPlate}** was observed across **${pCount} camera sighting${pCount > 1 ? 's' : ''}** covering ${distanceText}.\n\n` +
                `â€¢ **Surveillance Route:** ${camList}\n` +
                `â€¢ **First Sighting:** ${formatObservedTime(traj.points[0].timestamp)}\n` +
                `â€¢ **Latest Sighting:** ${formatObservedTime(traj.points[pCount - 1].timestamp)}\n` +
                `â€¢ **Kinematic Feasibility:** ${feasibilityText}`;
        structuredData = {
          type: 'TRAJECTORY',
          plate: plan.targetPlate,
          points: traj.points,
          segments: traj.segments,
          totalDistanceKm: traj.totalDistanceKm,
        };
      }
      break;
    }

    case INTENTS.LAST_KNOWN_LOCATION: {
      const loc = stepResults['get_latest_vehicle_location'];
      if (!loc || !loc.found) {
        reply = `Vehicle **${plan.targetPlate}** has no recorded sightings in the database.`;
      } else {
        reply = `Vehicle **${plan.targetPlate}** was last observed at camera **${loc.cameraName || loc.cameraId}** on **${formatObservedTime(loc.lastSeenAt)}**.\n\n` +
                `â€¢ **Coordinates:** ${formatCoordinates(loc.latitude, loc.longitude)}\n` +
                `â€¢ **Confidence:** ${formatConfidence(loc.confidence)}\n\n` +
                `*(Note: ${loc.disclaimer})*`;
        structuredData = {
          type: 'LAST_LOCATION',
          plate: plan.targetPlate,
          lastSeenAt: loc.lastSeenAt,
          cameraId: loc.cameraId,
          cameraName: loc.cameraName,
          coordinates: loc.latitude == null || loc.longitude == null ? null : [loc.longitude, loc.latitude],
        };
      }
      break;
    }

    case INTENTS.FIND_SIGHTINGS: {
      const sightingsRes = stepResults['get_vehicle_sightings'];
      if (!sightingsRes || sightingsRes.totalSightings === 0) {
        reply = `No camera sightings found for vehicle **${plan.targetPlate}** within the specified parameters.`;
      } else {
        reply = `Found **${sightingsRes.totalSightings} recorded sighting${sightingsRes.totalSightings > 1 ? 's' : ''}** for vehicle **${plan.targetPlate}**:\n\n` +
                sightingsRes.sightings.slice(0, 5).map(s => `â€¢ **${formatObservedTime(s.timestamp)}** at **${s.cameraName || s.cameraId}** (Confidence: ${formatConfidence(s.confidence, 0)})`).join('\n') +
                (sightingsRes.totalSightings > 5 ? `\n\n*(Showing top 5 sightings)*` : '');
        structuredData = {
          type: 'SIGHTINGS',
          plate: plan.targetPlate,
          sightings: sightingsRes.sightings,
        };
      }
      break;
    }

    case INTENTS.NEARBY_CAMERAS: {
      const camRes = stepResults['find_nearby_cameras'];
      if (!camRes || camRes.camerasFound === 0) {
        reply = `No surveillance cameras found within a ${camRes ? camRes.radiusKm : 5} km radius of the search coordinates.`;
      } else {
        reply = `Found **${camRes.camerasFound} registered surveillance camera${camRes.camerasFound > 1 ? 's' : ''}** within ${camRes.radiusKm} km:\n\n` +
                camRes.cameras.slice(0, 5).map(c => `â€¢ **${c.name}** (${c.id}) â€” Status: **${c.status}** ${formatCoordinates(c.latitude, c.longitude)}`).join('\n');
        structuredData = {
          type: 'CAMERAS',
          cameras: camRes.cameras,
        };
      }
      break;
    }

    case INTENTS.INVESTIGATION_SUMMARY: {
      const sum = stepResults['get_investigation_summary'];
      if (!sum || !sum.found) {
        reply = `No investigation data found for vehicle **${plan.targetPlate}**.`;
      } else {
        reply = `**Investigation Summary for Vehicle ${plan.targetPlate}:**\n\n` +
                `â€¢ **Total Sightings:** ${sum.sightingsCount}\n` +
                `â€¢ **Cameras Visited:** ${sum.camerasVisited.join(', ')}\n` +
                `â€¢ **First Seen:** ${formatObservedTime(sum.firstObservation)}\n` +
                `â€¢ **Last Seen:** ${formatObservedTime(sum.latestObservation)} at ${sum.latestLocation.cameraName || sum.latestLocation.cameraId || 'UNKNOWN'}\n` +
                `â€¢ **Vehicle Class:** ${sum.vehicle.vehicleType || 'Unknown'}`;
        structuredData = {
          type: 'SUMMARY',
          summary: sum,
        };
      }
      break;
    }

    case INTENTS.PROCESSING_STATUS: {
      const proc = stepResults['get_processing_status'];
      if (!proc || !proc.found) {
        reply = 'No active or recent video processing jobs found.';
      } else {
        const run = proc.run;
        reply = `**Video Processing Job Status:**\n\n` +
                `â€¢ **Run ID:** \`${run.id}\`\n` +
                `â€¢ **Status:** **${run.status}**\n` +
                `â€¢ **Frames Processed:** ${run.framesProcessed || 0}\n` +
                `â€¢ **Detections Extracted:** ${run.detectionsCount || 0}\n` +
                `â€¢ **Started At:** ${formatObservedTime(run.startedAt)}` +
                (run.errorMessage ? `\nâ€¢ **Error Detail:** ${run.errorMessage}` : '');
        structuredData = {
          type: 'PROCESSING_STATUS',
          run,
        };
      }
      break;
    }

    default: {
      reply = 'I analyzed your request, but could not determine a specific action plan. Try asking to trace a vehicle by plate or show a vehicle?s last known location.';
    }
  }

  if (mode === INVESTIGATION_MODES.HYBRID) {
    const liveStatus = {
      status: 'UNAVAILABLE',
      reason: 'Live capture and matching are not implemented for this deployment.',
    };
    reply += '\n\nLive component: unavailable. The results above, if any, are historical records only; no live camera feeds were checked.';
    structuredData = {
      ...(structuredData || { type: 'HYBRID_INVESTIGATION', historicalStatus: 'NO_MATCH' }),
      requestedMode: mode,
      live: liveStatus,
    };
  }

  // Update conversation history
  memory.updateSession(actor, session.id, {
    activePlate: session.activePlate,
    activeCaseId: caseId,
    message: { role: 'user', content: message, timestamp: new Date() },
  });
  memory.updateSession(actor, session.id, {
    message: { role: 'assistant', content: reply, structuredData, timestamp: new Date() },
  });

  return {
    reply,
    conversationId: session.id,
    intent,
    mode,
    plan,
    structuredData,
  };
}

module.exports = {
  processUserMessage,
};

