'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const foldersRouter = require('./routes/folders');
const filesRouter = require('./routes/files');
const sharesRouter = require('./routes/shares');
const uploadsRouter = require('./routes/uploads');

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: true, // Allow all origins for dev / proxy setups
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'ETag'],
    exposedHeaders: ['ETag', 'X-Cache'],
  })
);

// ─── Request Logging ──────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Health Routes ────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/health', healthRouter);

// ─── Helper function to mount routes at multiple prefix paths ─────────────────
// Allows seamless routing whether behind Nginx (/api/...) or accessed directly
function mountRouter(path, router) {
  app.use(path, router);
  app.use(`/api${path}`, router);
  app.use(`/api/v1${path}`, router);
  app.use(`/v1${path}`, router);
}

mountRouter('/auth', authRouter);
mountRouter('/folders', foldersRouter);
mountRouter('/files', filesRouter);
mountRouter('/shares', sharesRouter);
mountRouter('/uploads', uploadsRouter);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error('[Error]', err);
  }

  res.status(status).json({
    error: err.code || 'internal_error',
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
