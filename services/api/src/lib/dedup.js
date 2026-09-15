'use strict';

const prisma = require('./prisma');
const crypto = require('crypto');

/**
 * Calculates SHA-256 hash of a buffer
 */
function calculateChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Checks if a file with the identical checksum already exists in the database.
 * If found, returns the existing storageKey to achieve content-addressable deduplication.
 */
async function findExistingStorageKey(checksum) {
  if (!checksum) return null;
  try {
    const existingFile = await prisma.file.findFirst({
      where: {
        checksum,
        isTrashed: false,
      },
      select: { storageKey: true },
    });

    if (existingFile) {
      return existingFile.storageKey;
    }

    const existingVersion = await prisma.fileVersion.findFirst({
      where: { checksum },
      select: { storageKey: true },
    });

    return existingVersion ? existingVersion.storageKey : null;
  } catch (err) {
    console.warn('[Dedup] Checksum lookup warning:', err.message);
    return null;
  }
}

module.exports = {
  calculateChecksum,
  findExistingStorageKey,
};
