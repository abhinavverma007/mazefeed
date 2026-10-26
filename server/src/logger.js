const pino = require('pino');

// Render (and most hosts) set NODE_ENV=production, but RENDER itself is also
// set automatically - checking both means we default to safe, aggregator-
// friendly JSON output unless we're confident this is a local dev session.
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const logger = pino(
  isProd
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
);

module.exports = logger;
