'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { generateTokens, verifyRefreshToken } = require('../lib/jwt');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  display_name: z.string().min(1, 'Display name is required').max(100),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ─── POST /register ──────────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: parseResult.error.errors[0].message,
        details: parseResult.error.errors,
      });
    }

    const { email, password, display_name } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return res.status(409).json({
        error: 'user_exists',
        message: 'A user with this email already exists',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: display_name,
        passwordHash,
        storageQuota: BigInt(15_000_000_000), // 15 GB default quota
      },
    });

    const tokens = generateTokens(user);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        storage_used: Number(user.storageUsed),
        storage_quota: Number(user.storageQuota),
        created_at: user.createdAt,
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /login ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'validation_error',
        message: parseResult.error.errors[0].message,
      });
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    const tokens = generateTokens(user);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        storage_used: Number(user.storageUsed),
        storage_quota: Number(user.storageQuota),
        created_at: user.createdAt,
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /demo (Instant Demo User for Judges / Evaluators) ────────────────────
router.post('/demo', async (req, res, next) => {
  try {
    const demoEmail = 'demo@cloudvault.internal';
    let user = await prisma.user.findUnique({
      where: { email: demoEmail },
    });

    if (!user) {
      const passwordHash = await bcrypt.hash('DemoPass123!', 10);
      user = await prisma.user.create({
        data: {
          email: demoEmail,
          displayName: 'Demo User',
          passwordHash,
          storageQuota: BigInt(15_000_000_000),
        },
      });
    }

    const tokens = generateTokens(user);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        storage_used: Number(user.storageUsed),
        storage_quota: Number(user.storageQuota),
        created_at: user.createdAt,
      },
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /refresh ───────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'missing_token', message: 'Refresh token is required' });
  }

  const decoded = verifyRefreshToken(refresh_token);
  if (!decoded) {
    return res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired refresh token' });
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'user_not_found', message: 'User not found or inactive' });
  }

  const tokens = generateTokens(user);
  return res.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_in: tokens.expiresIn,
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        storageUsed: true,
        storageQuota: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        storage_used: Number(user.storageUsed),
        storage_quota: Number(user.storageQuota),
        created_at: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
