'use strict';

const fs = require('fs');
const { saveFile, getFileStream, deleteFile, getStorageStatus } = require('../src/lib/storage');

describe('Resilient Storage Layer Tests', () => {
  const testKey = 'test-suite/sample.txt';
  const testContent = Buffer.from('Hello CloudVault Resilient Storage!');
  const testMime = 'text/plain';

  test('reports active storage mode', () => {
    const status = getStorageStatus();
    expect(status).toHaveProperty('mode');
    expect(['minio', 'local_disk']).toContain(status.mode);
  });

  test('saves and reads file stream correctly', async () => {
    const saveResult = await saveFile(testKey, testContent, testMime);
    expect(saveResult.storageKey).toBe(testKey);

    const stream = await getFileStream(testKey);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const readBuffer = Buffer.concat(chunks);
    expect(readBuffer.toString()).toBe(testContent.toString());
  });

  test('deletes file cleanly', async () => {
    await deleteFile(testKey);
    // Verifying getFileStream rejects or cannot find file
    await expect(getFileStream(testKey)).rejects.toThrow();
  });
});
