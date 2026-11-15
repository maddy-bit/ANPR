/**
 * Live Tracking WebSocket Server
 * Implements RFC 6455 raw WebSocket protocol for GET /ws/live/{plate}.
 * Broadcasts genuine live camera detection events to connected client sessions.
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { normalize } = require('../utils/plate-normalizer');
const vehicleRepo = require('../modules/vehicles/vehicle.repository');
const { getRedisSubscriber } = require('../integrations/redis/client');
const config = require('../config/env');
const logger = require('../config/logger');

const activePlateSessions = new Map(); // plate -> Set<WebSocket>

/**
 * Opt-in WebSocket authentication: when WS_AUTH_TOKEN is configured, upgrade
 * requests must present it as the `token` query parameter (constant-time
 * comparison). Unset = open upgrade with a loud startup warning (see
 * SECURITY_AUDIT.md).
 */
function isAuthorizedUpgrade(url) {
  if (!config.security.wsAuthToken) {
    return true;
  }
  const provided = url.searchParams.get('token') || '';
  const hashA = crypto.createHash('sha256').update(provided).digest();
  const hashB = crypto.createHash('sha256').update(config.security.wsAuthToken).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function setupLiveTrackingWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  if (!config.security.wsAuthToken) {
    logger.warn(
      'WS_AUTH_TOKEN is not configured: WebSocket upgrades at /ws/live/{plate} are ' +
      'unauthenticated. This is intended only for local-only deployments; set WS_AUTH_TOKEN before any non-local deployment.'
    );
  }

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', (err) => {
      logger.debug({ err: err.message }, 'WebSocket upgrade socket error');
    });

    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const match = url.pathname.match(/^\/ws\/live\/([^/]+)$/);

      if (match) {
        if (!isAuthorizedUpgrade(url)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const rawPlate = decodeURIComponent(match[1]);
          wss.emit('connection', ws, request, rawPlate);
        });
      } else {
        socket.destroy();
      }
    } catch (e) {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, request, rawPlate) => {
    const normalized = normalize(rawPlate);
    if (!normalized) {
      sendAndClose(ws, { type: 'error', message: 'No plate specified. Connect to /ws/live/{plate}.' });
      return;
    }

    // Check if vehicle exists or get historical detection count
    let historicalCount = 0;
    try {
      const detections = await vehicleRepo.findDetectionsByPlate(normalized);
      historicalCount = detections ? detections.length : 0;
    } catch (e) {
      // In fresh/unseeded databases, allow connection in standby mode
    }

    if (!activePlateSessions.has(normalized)) {
      activePlateSessions.set(normalized, new Set());
    }
    activePlateSessions.get(normalized).add(ws);

    // Send connected handshake banner with both protocol and frontend-compatible fields
    send(ws, {
      type: 'connected',
      plate: normalized,
      status: 'LIVE_STREAM_STANDBY',
      historicalPoints: historicalCount,
      totalEvents: historicalCount,
      message: 'Live camera tracking stream connected. Awaiting real-time detection events.',
    });

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    logger.info({ plate: normalized }, 'Live tracking WebSocket connection established');

    ws.on('close', () => {
      const sessions = activePlateSessions.get(normalized);
      if (sessions) {
        sessions.delete(ws);
        if (sessions.size === 0) {
          activePlateSessions.delete(normalized);
        }
      }
      logger.debug({ plate: normalized }, 'Live tracking WebSocket connection closed');
    });

    ws.on('error', (err) => {
      logger.debug({ err: err.message, plate: normalized }, 'WebSocket error');
    });
  });

  // Setup Redis Pub/Sub listener for multi-instance broadcast
  try {
    const sub = getRedisSubscriber();
    sub.subscribe('cityai.detections', (err) => {
      if (!err) {
        logger.info('Subscribed to Redis channel cityai.detections for live WebSocket dispatch');
      }
    });

    sub.on('message', (channel, message) => {
      if (channel === 'cityai.detections') {
        try {
          const detection = JSON.parse(message);
          if (detection && detection.plateText) {
            broadcastLiveDetection(detection.plateText, detection);
          }
        } catch (e) {}
      }
    });
  } catch (err) {
    logger.debug({ err: err.message }, 'Redis pub/sub subscriber not active (operating locally)');
  }

  // Setup 30-second ping/pong heartbeat interval to clean up dead sockets
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  heartbeatInterval.unref();

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

function broadcastLiveDetection(plate, detection) {
  const normalized = normalize(plate);
  const sessions = activePlateSessions.get(normalized);
  if (!sessions || sessions.size === 0) return;

  const payload = {
    type: 'detection',
    plate: normalized,
    point: detection,
  };

  for (const ws of sessions) {
    if (ws.readyState === ws.OPEN) {
      send(ws, payload);
    }
  }
}

function send(ws, msg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch (e) {}
}

function sendAndClose(ws, msg) {
  send(ws, msg);
  try {
    ws.close(1000, 'NORMAL_CLOSURE');
  } catch (e) {}
}

module.exports = {
  setupLiveTrackingWebSocket,
  broadcastLiveDetection,
};
