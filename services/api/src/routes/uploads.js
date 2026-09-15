'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { saveFile } = require('../lib/storage');
const { calculateChecksum, findExistingStorageKey } = require('../lib/dedup');
const { invalidateCache, getFolderCacheKey, getFilesCacheKey } = require('../lib/cache');
const { publishEvent } = require('../lib/events');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per chunk
});

// Temp chunk storage directory
const CHUNK_TEMP_DIR = path.resolve(__dirname, '../../uploads/temp_chunks');
if (!fs.existsSync(CHUNK_TEMP_DIR)) {
  fs.mkdirSync(CHUNK_TEMP_DIR, { recursive: true });
}

// In-memory session registry (backed by disk chunk files)
const activeSessions = new Map();

// Clean stale sessions after 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.createdAt < cutoff) {
      const sessionDir = path.join(CHUNK_TEMP_DIR, sessionId);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      activeSessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// ─── POST /uploads/initiate ──────────────────────────────────────────────────
router.post('/initiate', async (req, res, next) => {
  try {
    const { file_name, total_size, total_chunks, mime_type, folder_id } = req.body;
    const ownerId = req.user.id;

    if (!file_name || !total_size || !total_chunks) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'file_name, total_size, and total_chunks are required',
      });
    }

    const totalBytes = BigInt(total_size);
    const user = await prisma.user.findUnique({ where: { id: ownerId } });

    if (user.storageUsed + totalBytes > user.storageQuota) {
      return res.status(413).json({
        error: 'quota_exceeded',
        message: 'Storage quota exceeded',
      });
    }

    const sessionId = uuidv4();
    const sessionDir = path.join(CHUNK_TEMP_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    activeSessions.set(sessionId, {
      sessionId,
      ownerId,
      fileName: file_name,
      totalSize: totalBytes,
      totalChunks: parseInt(total_chunks, 10),
      mimeType: mime_type || 'application/octet-stream',
      folderId: folder_id || null,
      uploadedChunks: new Set(),
      createdAt: Date.now(),
    });

    return res.status(201).json({
      session_id: sessionId,
      chunk_size: 2 * 1024 * 1024, // 2 MB recommended
      total_chunks: parseInt(total_chunks, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /uploads/:sessionId/part ───────────────────────────────────────────
router.post('/:sessionId/part', upload.single('chunk'), async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session || session.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'session_not_found', message: 'Invalid or expired upload session' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'no_chunk', message: 'No chunk file received' });
    }

    const chunkIndex = parseInt(req.body.chunk_index !== undefined ? req.body.chunk_index : req.query.chunk_index, 10);
    if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return res.status(400).json({ error: 'invalid_chunk_index', message: 'Chunk index is out of bounds' });
    }

    const chunkPath = path.join(CHUNK_TEMP_DIR, sessionId, `part_${chunkIndex}.chunk`);
    await fs.promises.writeFile(chunkPath, req.file.buffer);

    session.uploadedChunks.add(chunkIndex);

    return res.json({
      success: true,
      chunk_index: chunkIndex,
      uploaded_count: session.uploadedChunks.size,
      total_chunks: session.totalChunks,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /uploads/:sessionId/status ──────────────────────────────────────────
router.get('/:sessionId/status', async (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);

  if (!session || session.ownerId !== req.user.id) {
    return res.status(404).json({ error: 'session_not_found', message: 'Invalid or expired session' });
  }

  return res.json({
    session_id: sessionId,
    total_chunks: session.totalChunks,
    uploaded_chunks: Array.from(session.uploadedChunks).sort((a, b) => a - b),
    is_ready: session.uploadedChunks.size === session.totalChunks,
  });
});

// ─── POST /uploads/:sessionId/complete ───────────────────────────────────────
router.post('/:sessionId/complete', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session || session.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'session_not_found', message: 'Invalid or expired session' });
    }

    if (session.uploadedChunks.size < session.totalChunks) {
      return res.status(400).json({
        error: 'incomplete_upload',
        message: `Only ${session.uploadedChunks.size} of ${session.totalChunks} chunks uploaded`,
      });
    }

    const sessionDir = path.join(CHUNK_TEMP_DIR, sessionId);
    const chunkBuffers = [];

    for (let i = 0; i < session.totalChunks; i++) {
      const partPath = path.join(sessionDir, `part_${i}.chunk`);
      const partBuffer = await fs.promises.readFile(partPath);
      chunkBuffers.push(partBuffer);
    }

    const fullBuffer = Buffer.concat(chunkBuffers);
    const checksum = calculateChecksum(fullBuffer);

    // Check content-addressable deduplication
    let storageKey = await findExistingStorageKey(checksum);
    let isDeduplicated = false;

    if (storageKey) {
      isDeduplicated = true;
    } else {
      const fileExt = session.fileName.includes('.')
        ? session.fileName.substring(session.fileName.lastIndexOf('.'))
        : '';
      storageKey = `${session.ownerId}/${uuidv4()}${fileExt}`;
      await saveFile(storageKey, fullBuffer, session.mimeType);
    }

    // Check if file with same name exists in destination folder -> create new version!
    const existingFile = await prisma.file.findFirst({
      where: {
        ownerId: session.ownerId,
        folderId: session.folderId,
        name: session.fileName,
        isTrashed: false,
      },
      include: { versions: true },
    });

    let resultFile;

    if (existingFile) {
      const nextVersion = existingFile.versions.length + 1;

      // Update file pointer and create version record
      const [updatedFile] = await prisma.$transaction([
        prisma.file.update({
          where: { id: existingFile.id },
          data: {
            size: session.totalSize,
            storageKey,
            checksum,
            mimeType: session.mimeType,
          },
        }),
        prisma.fileVersion.create({
          data: {
            fileId: existingFile.id,
            versionNumber: nextVersion,
            storageKey,
            size: session.totalSize,
            checksum,
            createdById: session.ownerId,
          },
        }),
        prisma.user.update({
          where: { id: session.ownerId },
          data: { storageUsed: { increment: session.totalSize - existingFile.size } },
        }),
      ]);
      resultFile = updatedFile;
    } else {
      // Create new file and version 1
      const [newFile] = await prisma.$transaction([
        prisma.file.create({
          data: {
            name: session.fileName,
            ownerId: session.ownerId,
            folderId: session.folderId,
            mimeType: session.mimeType,
            size: session.totalSize,
            storageKey,
            checksum,
          },
        }),
        prisma.user.update({
          where: { id: session.ownerId },
          data: { storageUsed: { increment: session.totalSize } },
        }),
      ]);

      await prisma.fileVersion.create({
        data: {
          fileId: newFile.id,
          versionNumber: 1,
          storageKey,
          size: session.totalSize,
          checksum,
          createdById: session.ownerId,
        },
      });
      resultFile = newFile;
    }

    // Cleanup temp chunks
    fs.rmSync(sessionDir, { recursive: true, force: true });
    activeSessions.delete(sessionId);

    // Invalidate caches & notify
    await invalidateCache(getFilesCacheKey(session.ownerId, session.folderId, false));
    await publishEvent('file_uploaded', {
      file_id: resultFile.id,
      name: resultFile.name,
      owner_id: session.ownerId,
      size: Number(resultFile.size),
      deduplicated: isDeduplicated,
    });

    return res.status(201).json({
      file: {
        id: resultFile.id,
        name: resultFile.name,
        size: Number(resultFile.size),
        mime_type: resultFile.mimeType,
        folder_id: resultFile.folderId,
        is_deduplicated: isDeduplicated,
        created_at: resultFile.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /uploads/:sessionId/abort ────────────────────────────────────────
router.delete('/:sessionId/abort', async (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);

  if (session && session.ownerId === req.user.id) {
    const sessionDir = path.join(CHUNK_TEMP_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    activeSessions.delete(sessionId);
  }

  return res.json({ success: true, message: 'Upload session aborted' });
});

module.exports = router;
