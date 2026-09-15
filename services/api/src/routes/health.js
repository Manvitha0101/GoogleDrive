'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const redis = require('../lib/redis');
const { minioClient } = require('../lib/minio');

const router = express.Router();

/**
 * GET /health
 *
 * Returns the operational status of the API and all its dependencies.
 * Used by load balancers, Docker health checks, and monitoring systems.
 *
 * Response 200: all dependencies healthy
 * Response 503: one or more dependencies degraded
 */
router.get('/', async (req, res) => {
  const response = {
    status: 'ok',
    service: 'cloudvault-api',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    dependencies: {
      postgres: { status: 'unknown' },
      redis: { status: 'unknown' },
      minio: { status: 'unknown' },
    },
  };

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.dependencies.postgres = { status: 'connected' };
  } catch (err) {
    response.dependencies.postgres = { status: 'error', message: err.message };
    response.status = 'degraded';
  }

  // ── Redis ───────────────────────────────────────────────────────────────────
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') {
      response.dependencies.redis = { status: 'connected' };
    } else {
      response.dependencies.redis = { status: 'unexpected_response', message: pong };
      response.status = 'degraded';
    }
  } catch (err) {
    response.dependencies.redis = { status: 'error', message: err.message };
    response.status = 'degraded';
  }

  // ── MinIO ───────────────────────────────────────────────────────────────────
  try {
    await minioClient.listBuckets();
    response.dependencies.minio = { status: 'connected' };
  } catch (err) {
    response.dependencies.minio = { status: 'error', message: err.message };
    response.status = 'degraded';
  }

  const httpStatus = response.status === 'ok' ? 200 : 503;
  return res.status(httpStatus).json(response);
});

module.exports = router;
