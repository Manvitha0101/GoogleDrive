'use strict';

const redis = require('./redis');

// In-memory fallback map for environments where Redis is not running
const memoryCache = new Map();

/**
 * Get cached JSON value by key
 */
async function getCache(key) {
  try {
    if (redis.status === 'ready') {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    }
  } catch (err) {
    // fallback to memory
  }

  const mem = memoryCache.get(key);
  if (mem && mem.expiry > Date.now()) {
    return mem.value;
  }
  memoryCache.delete(key);
  return null;
}

/**
 * Set cached JSON value with TTL in seconds (default 60s)
 */
async function setCache(key, value, ttlSeconds = 60) {
  try {
    if (redis.status === 'ready') {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    }
  } catch (err) {
    // fallback to memory
  }

  memoryCache.set(key, {
    value,
    expiry: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Invalidate cache key or pattern
 */
async function invalidateCache(prefix) {
  try {
    if (redis.status === 'ready') {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  } catch (err) {
    // fallback
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Helper: cache key for user folder view
 */
function getFolderCacheKey(userId, folderId) {
  return `cache:folders:${userId}:${folderId || 'root'}`;
}

/**
 * Helper: cache key for user files view
 */
function getFilesCacheKey(userId, folderId, isTrashed) {
  return `cache:files:${userId}:${folderId || 'root'}:${isTrashed ? 'trash' : 'active'}`;
}

module.exports = {
  getCache,
  setCache,
  invalidateCache,
  getFolderCacheKey,
  getFilesCacheKey,
};
