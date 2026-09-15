'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { saveFile, getFileStream, deleteFile } = require('../lib/storage');
const { calculateChecksum, findExistingStorageKey } = require('../lib/dedup');
const { getCache, setCache, invalidateCache, getFilesCacheKey } = require('../lib/cache');
const { publishEvent } = require('../lib/events');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max single upload
});

// Helper: generate ETag for concurrency conflict detection
function generateETag(file) {
  const hash = crypto.createHash('md5').update(`${file.id}:${file.updatedAt.getTime()}:${file.size}`).digest('hex');
  return `"${hash}"`;
}

// ─── GET /files ──────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const folderId = req.query.folder_id === undefined || req.query.folder_id === 'null' || req.query.folder_id === ''
      ? null
      : req.query.folder_id;
    const isTrashed = req.query.is_trashed === 'true';
    const search = req.query.search ? req.query.search.trim() : null;

    const cacheKey = !search ? getFilesCacheKey(ownerId, folderId, isTrashed) : null;

    // Check Redis cache if not a search query
    if (cacheKey) {
      const cached = await getCache(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    }

    const where = {
      ownerId,
      isTrashed,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' } }
        : isTrashed
        ? {}
        : { folderId }),
    };

    const files = await prisma.file.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        folder: { select: { id: true, name: true } },
        versions: { select: { id: true, versionNumber: true } },
      },
    });

    const responseData = {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: Number(f.size),
        mime_type: f.mimeType,
        folder_id: f.folderId,
        folder_name: f.folder?.name || null,
        owner_id: f.ownerId,
        is_trashed: f.isTrashed,
        versions_count: f.versions.length,
        etag: generateETag(f),
        created_at: f.createdAt,
        updated_at: f.updatedAt,
      })),
    };

    if (cacheKey) {
      await setCache(cacheKey, responseData, 60);
      res.setHeader('X-Cache', 'MISS');
    }

    return res.json(responseData);
  } catch (err) {
    next(err);
  }
});

// ─── POST /files/upload ──────────────────────────────────────────────────────
router.post('/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'no_file', message: 'No file uploaded' });
    }

    const ownerId = req.user.id;
    const folderId = req.body.folder_id === undefined || req.body.folder_id === 'null' || req.body.folder_id === ''
      ? null
      : req.body.folder_id;

    // Check quota
    const user = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'User not found' });

    const fileSize = BigInt(req.file.size);
    if (user.storageUsed + fileSize > user.storageQuota) {
      return res.status(413).json({
        error: 'quota_exceeded',
        message: 'Storage quota exceeded (15 GB limit reached).',
      });
    }

    // Calculate checksum & check deduplication
    const checksum = calculateChecksum(req.file.buffer);
    let storageKey = await findExistingStorageKey(checksum);
    let isDeduplicated = false;

    if (storageKey) {
      isDeduplicated = true;
    } else {
      const fileExt = req.file.originalname.includes('.')
        ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.'))
        : '';
      storageKey = `${ownerId}/${uuidv4()}${fileExt}`;
      await saveFile(storageKey, req.file.buffer, req.file.mimetype);
    }

    // Check if file with same name already exists in target folder -> versioning!
    const existingFile = await prisma.file.findFirst({
      where: {
        ownerId,
        folderId,
        name: req.file.originalname,
        isTrashed: false,
      },
      include: { versions: true },
    });

    let resultFile;

    if (existingFile) {
      const nextVersion = existingFile.versions.length + 1;
      const sizeDelta = fileSize - existingFile.size;

      const [updated] = await prisma.$transaction([
        prisma.file.update({
          where: { id: existingFile.id },
          data: {
            size: fileSize,
            storageKey,
            checksum,
            mimeType: req.file.mimetype || 'application/octet-stream',
          },
        }),
        prisma.fileVersion.create({
          data: {
            fileId: existingFile.id,
            versionNumber: nextVersion,
            storageKey,
            size: fileSize,
            checksum,
            createdById: ownerId,
          },
        }),
        prisma.user.update({
          where: { id: ownerId },
          data: { storageUsed: { increment: sizeDelta } },
        }),
      ]);
      resultFile = updated;
    } else {
      const [newFile] = await prisma.$transaction([
        prisma.file.create({
          data: {
            name: req.file.originalname,
            ownerId,
            folderId,
            mimeType: req.file.mimetype || 'application/octet-stream',
            size: fileSize,
            storageKey,
            checksum,
          },
        }),
        prisma.user.update({
          where: { id: ownerId },
          data: { storageUsed: { increment: fileSize } },
        }),
      ]);

      await prisma.fileVersion.create({
        data: {
          fileId: newFile.id,
          versionNumber: 1,
          storageKey,
          size: fileSize,
          checksum,
          createdById: ownerId,
        },
      });
      resultFile = newFile;
    }

    // Invalidate Redis cache & publish real-time notification
    await invalidateCache(`cache:files:${ownerId}`);
    await publishEvent('file_uploaded', {
      file_id: resultFile.id,
      name: resultFile.name,
      owner_id: ownerId,
      size: Number(resultFile.size),
      is_deduplicated: isDeduplicated,
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

// ─── GET /files/:id ──────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
      include: {
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });

    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const etag = generateETag(file);
    res.setHeader('ETag', etag);

    return res.json({
      file: {
        id: file.id,
        name: file.name,
        size: Number(file.size),
        mime_type: file.mimeType,
        folder_id: file.folderId,
        owner_id: file.ownerId,
        is_trashed: file.isTrashed,
        versions_count: file.versions.length,
        etag,
        created_at: file.createdAt,
        updated_at: file.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /files/:id/versions (Phase 4: Version History) ──────────────────────
router.get('/:id/versions', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const versions = await prisma.fileVersion.findMany({
      where: { fileId: file.id },
      orderBy: { versionNumber: 'desc' },
      include: {
        createdBy: { select: { displayName: true, email: true } },
      },
    });

    return res.json({
      file_id: file.id,
      name: file.name,
      current_version: versions[0]?.versionNumber || 1,
      versions: versions.map((v) => ({
        id: v.id,
        version_number: v.versionNumber,
        size: Number(v.size),
        checksum: v.checksum,
        created_by: v.createdBy.displayName,
        created_at: v.createdAt,
        is_current: v.storageKey === file.storageKey,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /files/:id/versions/:v/download (Download historical version) ──────
router.get('/:id/versions/:versionNumber/download', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const versionNum = parseInt(req.params.versionNumber, 10);
    const version = await prisma.fileVersion.findFirst({
      where: { fileId: file.id, versionNumber: versionNum },
    });

    if (!version) return res.status(404).json({ error: 'version_not_found', message: 'Version not found' });

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="v${versionNum}_${encodeURIComponent(file.name)}"`);
    res.setHeader('Content-Length', version.size.toString());

    const stream = await getFileStream(version.storageKey);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// ─── POST /files/:id/versions/:v/restore (Rollback to historical version) ───
router.post('/:id/versions/:versionNumber/restore', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
      include: { versions: true },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const targetVersionNum = parseInt(req.params.versionNumber, 10);
    const targetVersion = await prisma.fileVersion.findFirst({
      where: { fileId: file.id, versionNumber: targetVersionNum },
    });

    if (!targetVersion) return res.status(404).json({ error: 'version_not_found', message: 'Version not found' });

    const nextVersionNum = file.versions.length + 1;
    const sizeDelta = targetVersion.size - file.size;

    const [restored] = await prisma.$transaction([
      prisma.file.update({
        where: { id: file.id },
        data: {
          storageKey: targetVersion.storageKey,
          size: targetVersion.size,
          checksum: targetVersion.checksum,
        },
      }),
      prisma.fileVersion.create({
        data: {
          fileId: file.id,
          versionNumber: nextVersionNum,
          storageKey: targetVersion.storageKey,
          size: targetVersion.size,
          checksum: targetVersion.checksum,
          createdById: req.user.id,
        },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data: { storageUsed: { increment: sizeDelta } },
      }),
    ]);

    await invalidateCache(`cache:files:${req.user.id}`);
    await publishEvent('file_restored', {
      file_id: file.id,
      name: file.name,
      restored_from: targetVersionNum,
      new_version: nextVersionNum,
    });

    return res.json({
      success: true,
      message: `File restored to version ${targetVersionNum} (recorded as version ${nextVersionNum})`,
      file: restored,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /files/:id/download ─────────────────────────────────────────────────
router.get('/:id/download', optionalAuth, async (req, res, next) => {
  try {
    const fileId = req.params.id;
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const isOwner = req.user && req.user.id === file.ownerId;
    let hasShareAccess = false;

    if (!isOwner) {
      const shareToken = req.query.token;
      if (shareToken) {
        const share = await prisma.share.findFirst({
          where: { itemId: file.id, itemType: 'file', shareToken },
        });
        if (share) hasShareAccess = true;
      } else if (req.user) {
        const share = await prisma.share.findFirst({
          where: { itemId: file.id, itemType: 'file', sharedWithId: req.user.id },
        });
        if (share) hasShareAccess = true;
      }
    }

    if (!isOwner && !hasShareAccess) {
      return res.status(403).json({ error: 'forbidden', message: 'You lack permission to download this file' });
    }

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Content-Length', file.size.toString());

    const stream = await getFileStream(file.storageKey);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /files/:id (Phase 9: Concurrency Conflict Detection) ─────────────
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    // Concurrency Check with ETag
    const ifMatch = req.headers['if-match'];
    const currentETag = generateETag(file);

    if (ifMatch && ifMatch !== currentETag && ifMatch !== '*') {
      return res.status(412).json({
        error: 'precondition_failed',
        message: 'Conflict detected: The file has been modified since you retrieved it.',
        server_etag: currentETag,
        client_etag: ifMatch,
      });
    }

    const { name, folder_id, is_trashed } = req.body;
    const data = {};

    if (name !== undefined && name.trim()) data.name = name.trim();
    if (folder_id !== undefined) data.folderId = folder_id || null;
    if (is_trashed !== undefined) {
      data.isTrashed = Boolean(is_trashed);
      data.trashedAt = is_trashed ? new Date() : null;
    }

    const updated = await prisma.file.update({
      where: { id: file.id },
      data,
    });

    await invalidateCache(`cache:files:${req.user.id}`);

    const newETag = generateETag(updated);
    res.setHeader('ETag', newETag);

    return res.json({
      file: {
        id: updated.id,
        name: updated.name,
        size: Number(updated.size),
        mime_type: updated.mimeType,
        folder_id: updated.folderId,
        is_trashed: updated.isTrashed,
        etag: newETag,
        updated_at: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /files/:id/restore ─────────────────────────────────────────────────
router.post('/:id/restore', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    const updated = await prisma.file.update({
      where: { id: file.id },
      data: { isTrashed: false, trashedAt: null },
    });

    await invalidateCache(`cache:files:${req.user.id}`);

    return res.json({ success: true, message: 'File restored from trash', file: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /files/:id ───────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    await prisma.file.update({
      where: { id: file.id },
      data: { isTrashed: true, trashedAt: new Date() },
    });

    await invalidateCache(`cache:files:${req.user.id}`);
    await publishEvent('file_trashed', { file_id: file.id, name: file.name });

    return res.json({ success: true, message: 'File moved to trash' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /files/:id/permanent ─────────────────────────────────────────────
router.delete('/:id/permanent', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!file) return res.status(404).json({ error: 'file_not_found', message: 'File not found' });

    // Check if other files share the same storageKey before deleting physical bytes
    const otherReferences = await prisma.file.count({
      where: { storageKey: file.storageKey, id: { not: file.id } },
    });

    if (otherReferences === 0) {
      await deleteFile(file.storageKey);
    }

    await prisma.$transaction([
      prisma.file.delete({ where: { id: file.id } }),
      prisma.user.update({
        where: { id: file.ownerId },
        data: { storageUsed: { decrement: file.size } },
      }),
    ]);

    await invalidateCache(`cache:files:${req.user.id}`);

    return res.json({ success: true, message: 'File permanently deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
