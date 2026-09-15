'use strict';

const fs = require('fs');
const path = require('path');
const { minioClient, BUCKET, REGION } = require('./minio');

const LOCAL_STORAGE_DIR = path.resolve(__dirname, '../../uploads');
let useMinio = false;

// Ensure local fallback storage directory exists
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

async function initStorage() {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, REGION);
      console.log(`[Storage] MinIO bucket '${BUCKET}' created in region '${REGION}'`);
    } else {
      console.log(`[Storage] MinIO bucket '${BUCKET}' active`);
    }
    useMinio = true;
    return { mode: 'minio', status: 'connected' };
  } catch (err) {
    console.warn(`[Storage] MinIO unavailable (${err.message}). Falling back to local disk storage at ${LOCAL_STORAGE_DIR}`);
    useMinio = false;
    return { mode: 'local_disk', status: 'fallback', dir: LOCAL_STORAGE_DIR };
  }
}

async function saveFile(storageKey, buffer, mimeType) {
  if (useMinio) {
    try {
      await minioClient.putObject(BUCKET, storageKey, buffer, buffer.length, {
        'Content-Type': mimeType || 'application/octet-stream',
      });
      return { storageKey, mode: 'minio' };
    } catch (err) {
      console.warn(`[Storage] MinIO putObject failed (${err.message}), falling back to disk write`);
    }
  }

  // Disk fallback
  const filePath = path.join(LOCAL_STORAGE_DIR, storageKey);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  await fs.promises.writeFile(filePath, buffer);
  return { storageKey, mode: 'local_disk' };
}

async function getFileStream(storageKey) {
  if (useMinio) {
    try {
      return await minioClient.getObject(BUCKET, storageKey);
    } catch (err) {
      console.warn(`[Storage] MinIO getObject failed (${err.message}), attempting local disk read`);
    }
  }

  const filePath = path.join(LOCAL_STORAGE_DIR, storageKey);
  if (fs.existsSync(filePath)) {
    return fs.createReadStream(filePath);
  }
  throw new Error(`Storage key not found: ${storageKey}`);
}

async function deleteFile(storageKey) {
  if (useMinio) {
    try {
      await minioClient.removeObject(BUCKET, storageKey);
    } catch (err) {
      console.warn(`[Storage] MinIO removeObject warning (${err.message})`);
    }
  }

  const filePath = path.join(LOCAL_STORAGE_DIR, storageKey);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

function getStorageStatus() {
  return {
    mode: useMinio ? 'minio' : 'local_disk',
    minioReady: useMinio,
    localStorageDir: LOCAL_STORAGE_DIR,
  };
}

module.exports = {
  initStorage,
  saveFile,
  getFileStream,
  deleteFile,
  getStorageStatus,
};
