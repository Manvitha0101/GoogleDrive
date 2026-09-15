'use strict';

const Minio = require('minio');

const BUCKET = process.env.MINIO_BUCKET || 'cloudvault-files';
const REGION = 'us-east-1';

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'cloudvault',
  secretKey: process.env.MINIO_SECRET_KEY || 'cloudvault_secret_123',
});

/**
 * Ensures the CloudVault bucket exists in MinIO.
 * Called once at server startup (server.js).
 */
async function initMinio() {
  const maxAttempts = 5;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const exists = await minioClient.bucketExists(BUCKET);
      if (!exists) {
        await minioClient.makeBucket(BUCKET, REGION);
        console.log(`[MinIO] Bucket '${BUCKET}' created in region '${REGION}'`);
      } else {
        console.log(`[MinIO] Bucket '${BUCKET}' already exists`);
      }
      return; // success
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw new Error(`[MinIO] Failed to initialize after ${maxAttempts} attempts: ${err.message}`);
      }
      const wait = attempt * 1000;
      console.warn(`[MinIO] Attempt ${attempt} failed (${err.message}). Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

module.exports = { minioClient, initMinio, BUCKET, REGION };
