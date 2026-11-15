/**
 * Main Server Entry Point
 */

const http = require('http');
const app = require('./app');
const config = require('./config/env');
const logger = require('./config/logger');
const { closePool } = require('./database/pool');
const { closeRedis } = require('./integrations/redis/client');
const { setupLiveTrackingWebSocket } = require('./websocket/live-tracking');
const { startRecoveryWorker, stopRecoveryWorker } = require('./modules/processing/outbox.service');
const { startCameraSourceSync, stopCameraSourceSync } = require('./modules/cameras/camera-source.service');

const server = http.createServer(app);

// Handle client-level socket errors gracefully
server.on('clientError', (err, socket) => {
  logger.debug({ err: err.message }, 'Client connection socket error');
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } else {
    socket.destroy();
  }
});

// Attach WebSocket live tracking engine
setupLiveTrackingWebSocket(server);

// Start durable AI job recovery worker
startRecoveryWorker();
startCameraSourceSync();

server.listen(config.port, config.host, () => {
  logger.info('CityAI Node.js Backend listening on %s:%d (%s mode)', config.host, config.port, config.env);
});

// Graceful Shutdown
let isShuttingDown = false;

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Received termination signal. Commencing graceful shutdown...');

  server.close(async () => {
    logger.info('HTTP server closed');
    stopRecoveryWorker();
    stopCameraSourceSync();
    try {
      await closePool();
      await closeRedis();
      logger.info('All database and Redis connections released cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful resource shutdown');
      process.exit(1);
    }
  });

  // Force exit after 10s timeout
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ err: reason }, 'Unhandled Promise Rejection caught at process level');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception caught at process level');
});

module.exports = server;
