'use strict';

const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

const redis = new Redis(redisUrl, {
  retryStrategy(times) {
    if (times > 5) {
      // Don't hammer if redis is unavailable
      return null;
    }
    return Math.min(times * 500, 2000);
  },
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('ready', () => console.log('[Redis] Ready'));
redis.on('error', (err) => {
  // Graceful log without crashing
  if (process.env.NODE_ENV === 'development') {
    // only log occasionally
  }
});

module.exports = redis;
