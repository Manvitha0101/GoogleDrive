'use strict';

const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ─── POST /shares ────────────────────────────────────────────────────────────
// Share file/folder with user or generate link
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { item_id, item_type, share_type, email, permission } = req.body;
    const ownerId = req.user.id;

    if (!item_id || !item_type) {
      return res.status(400).json({ error: 'missing_fields', message: 'item_id and item_type are required' });
    }

    // Verify ownership
    if (item_type === 'file') {
      const file = await prisma.file.findFirst({ where: { id: item_id, ownerId } });
      if (!file) return res.status(404).json({ error: 'item_not_found', message: 'File not found' });
    } else if (item_type === 'folder') {
      const folder = await prisma.folder.findFirst({ where: { id: item_id, ownerId } });
      if (!folder) return res.status(404).json({ error: 'item_not_found', message: 'Folder not found' });
    }

    let sharedWithId = null;
    let shareToken = null;

    if (share_type === 'link') {
      shareToken = crypto.randomBytes(16).toString('hex');
    } else if (email) {
      const targetUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });
      if (!targetUser) {
        return res.status(404).json({ error: 'user_not_found', message: `No user found with email ${email}` });
      }
      if (targetUser.id === ownerId) {
        return res.status(400).json({ error: 'cannot_share_with_self', message: 'You already own this item' });
      }
      sharedWithId = targetUser.id;
    }

    const share = await prisma.share.create({
      data: {
        itemId: item_id,
        itemType: item_type,
        ownerId,
        sharedWithId,
        shareToken,
        permission: permission || 'viewer',
      },
    });

    return res.status(201).json({
      share: {
        id: share.id,
        item_id: share.itemId,
        item_type: share.itemType,
        share_token: share.shareToken,
        permission: share.permission,
        created_at: share.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shares/shared-with-me ──────────────────────────────────────────────
router.get('/shared-with-me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const shares = await prisma.share.findMany({
      where: { sharedWithId: userId },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
      },
    });

    // Fetch corresponding file / folder details
    const fileIds = shares.filter((s) => s.itemType === 'file').map((s) => s.itemId);
    const folderIds = shares.filter((s) => s.itemType === 'folder').map((s) => s.itemId);

    const [files, folders] = await Promise.all([
      prisma.file.findMany({ where: { id: { in: fileIds }, isTrashed: false } }),
      prisma.folder.findMany({ where: { id: { in: folderIds }, isTrashed: false } }),
    ]);

    const items = shares.map((s) => {
      const details = s.itemType === 'file'
        ? files.find((f) => f.id === s.itemId)
        : folders.find((f) => f.id === s.itemId);

      return {
        share_id: s.id,
        item_id: s.itemId,
        item_type: s.itemType,
        permission: s.permission,
        owner: s.owner,
        name: details?.name || 'Unknown item',
        size: details?.size ? Number(details.size) : null,
        mime_type: details?.mimeType || null,
        shared_at: s.createdAt,
      };
    }).filter((item) => item.name !== 'Unknown item');

    return res.json({ shared_items: items });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shares/public/:token ───────────────────────────────────────────────
router.get('/public/:token', async (req, res, next) => {
  try {
    const share = await prisma.share.findUnique({
      where: { shareToken: req.params.token },
      include: {
        owner: { select: { displayName: true, email: true } },
      },
    });

    if (!share) {
      return res.status(404).json({ error: 'share_not_found', message: 'Shared link not found or expired' });
    }

    if (share.itemType === 'file') {
      const file = await prisma.file.findUnique({ where: { id: share.itemId } });
      if (!file || file.isTrashed) {
        return res.status(404).json({ error: 'file_not_found', message: 'Shared file is no longer available' });
      }
      return res.json({
        item_type: 'file',
        file: {
          id: file.id,
          name: file.name,
          size: Number(file.size),
          mime_type: file.mimeType,
          shared_by: share.owner.displayName,
          permission: share.permission,
          download_url: `/api/v1/files/${file.id}/download?token=${share.shareToken}`,
        },
      });
    }

    return res.json({ share });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /shares/:id ──────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const share = await prisma.share.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });

    if (!share) {
      return res.status(404).json({ error: 'share_not_found', message: 'Share not found' });
    }

    await prisma.share.delete({ where: { id: share.id } });
    return res.json({ success: true, message: 'Share access revoked' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
