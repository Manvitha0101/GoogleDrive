'use strict';

const redis = require('./redis');

const EVENT_CHANNEL = 'cloudvault:events';

/**
 * Publish real-time event via Redis Pub/Sub
 */
async function publishEvent(eventType, payload) {
  const event = {
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
  };

  try {
    if (redis.status === 'ready') {
      await redis.publish(EVENT_CHANNEL, JSON.stringify(event));
    }
  } catch (err) {
    // Non-blocking log
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Events] Redis event publish warning:', err.message);
    }
  }
}

module.exports = {
  publishEvent,
  EVENT_CHANNEL,
};
