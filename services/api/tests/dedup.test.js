'use strict';

// Mock Prisma so tests don't need a live database
jest.mock('../src/lib/prisma', () => ({
  file: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  fileVersion: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
}));

const { calculateChecksum, findExistingStorageKey } = require('../src/lib/dedup');

describe('Block Hashing & Deduplication Tests', () => {
  test('calculateChecksum produces consistent SHA-256 hash', () => {
    const buffer1 = Buffer.from('CloudVault block deduplication sample');
    const buffer2 = Buffer.from('CloudVault block deduplication sample');
    const buffer3 = Buffer.from('Different data');

    const hash1 = calculateChecksum(buffer1);
    const hash2 = calculateChecksum(buffer2);
    const hash3 = calculateChecksum(buffer3);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64); // standard sha256 hex length
  });

  test('findExistingStorageKey returns null when no match found', async () => {
    const key = await findExistingStorageKey('non_existent_checksum_00000000000000000000000000000000');
    expect(key).toBeNull();
  });

  test('findExistingStorageKey returns null for empty/null input', async () => {
    expect(await findExistingStorageKey(null)).toBeNull();
    expect(await findExistingStorageKey('')).toBeNull();
  });

  test('findExistingStorageKey returns storageKey when file match exists', async () => {
    const prisma = require('../src/lib/prisma');
    prisma.file.findFirst.mockResolvedValueOnce({ storageKey: 'existing/file/key.txt' });

    const key = await findExistingStorageKey('abc123checksum');
    expect(key).toBe('existing/file/key.txt');
  });
});
