/**
 * Structured Logger using Pino
 */

const pino = require('pino');
const config = require('./env');

const isDev = config.env !== 'production';

let transport;
if (isDev) {
  try {
    transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    });
  } catch (e) {
    // Fall back to default json transport if pino-pretty is not loaded
    transport = undefined;
  }
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: { service: 'city-ai-backend-node' },
  },
  transport
);

module.exports = logger;
