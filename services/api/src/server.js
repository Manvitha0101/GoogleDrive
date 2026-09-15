'use strict';

require('dotenv').config();

const http = require('http');
const app = require('./app');
const { initStorage } = require('./lib/storage');

const PORT = parseInt(process.env.API_PORT || '8000', 10);
const HOST = '0.0.0.0';

async function start() {
  console.log('[CloudVault API] Starting...');
  console.log(`[CloudVault API] Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize storage layer (MinIO or local disk fallback)
  try {
    const storageStatus = await initStorage();
    console.log(`[CloudVault API] Storage initialized in ${storageStatus.mode} mode (${storageStatus.status})`);
  } catch (err) {
    console.warn('[CloudVault API] Storage initialization warning:', err.message);
  }

  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    console.log(`[CloudVault API] Listening on http://${HOST}:${PORT}`);
    console.log(`[CloudVault API] Health check: http://${HOST}:${PORT}/health`);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    console.log(`[CloudVault API] ${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('[CloudVault API] HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10 s
    setTimeout(() => {
      console.error('[CloudVault API] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[CloudVault API] Fatal error during startup:', err);
  process.exit(1);
});
