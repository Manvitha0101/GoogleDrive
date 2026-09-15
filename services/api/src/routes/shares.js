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

// Helper function to format bytes
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
  return `${(Number(bytes) / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function renderPublicSharePage(file, share, downloadUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${encodeURIComponent(file.name)} — CloudVault Public Share</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: radial-gradient(ellipse at top, #f8fafc 0%, #e2e8f0 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justifyContent: center;
      padding: 24px;
      color: #0f172a;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      padding: 36px 32px;
      width: 100%;
      maxWidth: 480px;
      box-shadow: 0 20px 40px -10px rgba(0,0,0,0.08);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(79, 70, 229, 0.08);
      color: #4f46e5;
      font-size: 12px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 20px;
      margin-bottom: 24px;
    }
    .file-icon {
      font-size: 56px;
      margin-bottom: 16px;
    }
    .file-name {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      word-break: break-word;
      margin-bottom: 8px;
    }
    .meta {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 28px;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .btn-download {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: linear-gradient(135deg, #4f46e5, #4338ca);
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      padding: 14px 24px;
      border-radius: 12px;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.35);
      transition: all 0.2s;
    }
    .btn-download:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.45);
    }
    .btn-copy {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">☁️ CloudVault Public Link</div>
    <div class="file-icon">📄</div>
    <div class="file-name">${file.name}</div>
    <div class="meta">
      ${formatBytes(file.size)} · Shared by ${share.owner?.displayName || 'CloudVault User'} · ${share.permission === 'editor' ? 'Editor' : 'Viewer'}
    </div>
    <div class="actions">
      <a href="${downloadUrl}" class="btn-download">
        <span>⬇️</span>
        <span>Download File (${formatBytes(file.size)})</span>
      </a>
      <button class="btn-copy" id="copyBtn" onclick="copyLink()">📋 Copy Share Link</button>
    </div>
  </div>
  <div class="footer">Protected by CloudVault Security & Encryption</div>
  <script>
    function copyLink() {
      navigator.clipboard.writeText(window.location.href);
      const btn = document.getElementById('copyBtn');
      btn.innerText = '✅ Copied to Clipboard!';
      setTimeout(() => btn.innerText = '📋 Copy Share Link', 2500);
    }
  </script>
</body>
</html>`;
}

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

      const downloadUrl = `/api/shares/public/${share.shareToken}/download`;

      // Check if direct download requested via ?download=true
      if (req.query.download === 'true' || req.query.download === '1') {
        return res.redirect(downloadUrl);
      }

      // Check if browser HTML navigation
      if (req.headers.accept && req.headers.accept.includes('text/html') && !req.query.json) {
        return res.send(renderPublicSharePage(file, share, downloadUrl));
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
          download_url: downloadUrl,
        },
      });
    }

    return res.json({ share });
  } catch (err) {
    next(err);
  }
});

// ─── GET /shares/public/:token/download ──────────────────────────────────────
router.get('/public/:token/download', async (req, res, next) => {
  try {
    const share = await prisma.share.findUnique({
      where: { shareToken: req.params.token },
    });

    if (!share || share.itemType !== 'file') {
      return res.status(404).json({ error: 'share_not_found', message: 'Download link expired or not found' });
    }

    const file = await prisma.file.findUnique({ where: { id: share.itemId } });
    if (!file || file.isTrashed) {
      return res.status(404).json({ error: 'file_not_found', message: 'File is not available' });
    }

    const { getFileStream } = require('../lib/storage');
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Content-Length', file.size.toString());

    const stream = await getFileStream(file.storageKey);
    stream.pipe(res);
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
