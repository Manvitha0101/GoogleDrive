'use strict';

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { getCache, setCache, invalidateCache, getFolderCacheKey } = require('../lib/cache');
const { publishEvent } = require('../lib/events');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const createFolderSchema = z.object({
  name: z.string().min(1, 'Folder name cannot be empty').max(255),
  parent_id: z.string().uuid().nullable().optional(),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_trashed: z.boolean().optional(),
});

// Helper: build breadcrumbs trail for a folder
async function getBreadcrumbs(folderId, ownerId) {
  const crumbs = [];
  let currentId = folderId;

  while (currentId) {
    const f = await prisma.folder.findFirst({
      where: { id: currentId, ownerId },
      select: { id: true, name: true, parentId: true },
    });
    if (!f) break;
    crumbs.unshift({ id: f.id, name: f.name });
    currentId = f.parentId;
  }

  crumbs.unshift({ id: null, name: 'My Drive' });
  return crumbs;
}

// ─── GET /folders ────────────────────────────────────────────────────────────
// List folders in a specific directory or trash
router.get('/', async (req, res, next) => {
  try {
    const ownerId = req.user.id;
    const parentId = req.query.parent_id === undefined || req.query.parent_id === 'null' || req.query.parent_id === ''
      ? null
      : req.query.parent_id;
    const isTrashed = req.query.is_trashed === 'true';

    const cacheKey = !isTrashed ? getFolderCacheKey(ownerId, parentId) : null;
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
      ...(isTrashed ? {} : { parentId }),
    };

    const folders = await prisma.folder.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const breadcrumbs = parentId ? await getBreadcrumbs(parentId, ownerId) : [{ id: null, name: 'My Drive' }];

    const responseData = {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parentId,
        owner_id: f.ownerId,
        is_trashed: f.isTrashed,
        created_at: f.createdAt,
        updated_at: f.updatedAt,
      })),
      breadcrumbs,
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

// ─── POST /folders ───────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const parseResult = createFolderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: parseResult.error.errors[0].message,
      });
    }

    const { name, parent_id } = parseResult.data;
    const ownerId = req.user.id;

    if (parent_id) {
      const parent = await prisma.folder.findFirst({
        where: { id: parent_id, ownerId, isTrashed: false },
      });
      if (!parent) {
        return res.status(404).json({
          error: 'parent_not_found',
          message: 'Parent folder does not exist or has been deleted',
        });
      }
    }

    const existing = await prisma.folder.findFirst({
      where: {
        ownerId,
        parentId: parent_id || null,
        name: name.trim(),
        isTrashed: false,
      },
    });

    if (existing) {
      return res.status(409).json({
        error: 'duplicate_folder_name',
        message: `A folder named '${name}' already exists in this location`,
      });
    }

    const folder = await prisma.folder.create({
      data: {
        name: name.trim(),
        parentId: parent_id || null,
        ownerId,
      },
    });

    await invalidateCache(`cache:folders:${ownerId}`);
    await publishEvent('folder_created', { folder_id: folder.id, name: folder.name, owner_id: ownerId });

    return res.status(201).json({
      folder: {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parentId,
        owner_id: folder.ownerId,
        created_at: folder.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /folders/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!folder) {
      return res.status(404).json({ error: 'folder_not_found', message: 'Folder not found' });
    }

    const breadcrumbs = await getBreadcrumbs(folder.id, req.user.id);

    return res.json({
      folder: {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parentId,
        owner_id: folder.ownerId,
        is_trashed: folder.isTrashed,
        created_at: folder.createdAt,
        updated_at: folder.updatedAt,
      },
      breadcrumbs,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /folders/:id ──────────────────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const parseResult = updateFolderSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'validation_error', message: parseResult.error.errors[0].message });
    }

    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!folder) {
      return res.status(404).json({ error: 'folder_not_found', message: 'Folder not found' });
    }

    const { name, parent_id, is_trashed } = parseResult.data;

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (parent_id !== undefined) data.parentId = parent_id;
    if (is_trashed !== undefined) {
      data.isTrashed = is_trashed;
      data.trashedAt = is_trashed ? new Date() : null;
    }

    const updated = await prisma.folder.update({
      where: { id: folder.id },
      data,
    });

    await invalidateCache(`cache:folders:${req.user.id}`);
    await invalidateCache(`cache:files:${req.user.id}`);

    return res.json({
      folder: {
        id: updated.id,
        name: updated.name,
        parent_id: updated.parentId,
        is_trashed: updated.isTrashed,
        updated_at: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /folders/:id (Soft delete / Move to trash) ───────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!folder) {
      return res.status(404).json({ error: 'folder_not_found', message: 'Folder not found' });
    }

    await prisma.$transaction([
      prisma.folder.update({
        where: { id: folder.id },
        data: { isTrashed: true, trashedAt: new Date() },
      }),
      prisma.file.updateMany({
        where: { folderId: folder.id },
        data: { isTrashed: true, trashedAt: new Date() },
      }),
    ]);

    await invalidateCache(`cache:folders:${req.user.id}`);
    await invalidateCache(`cache:files:${req.user.id}`);

    return res.json({ success: true, message: 'Folder moved to trash' });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /folders/:id/permanent (Permanent delete) ────────────────────────
router.delete('/:id/permanent', async (req, res, next) => {
  try {
    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!folder) {
      return res.status(404).json({ error: 'folder_not_found', message: 'Folder not found' });
    }

    await prisma.folder.delete({
      where: { id: folder.id },
    });

    await invalidateCache(`cache:folders:${req.user.id}`);
    await invalidateCache(`cache:files:${req.user.id}`);

    return res.json({ success: true, message: 'Folder permanently deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
