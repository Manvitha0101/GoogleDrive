'use strict';

require('dotenv').config();

const http = require('http');
const { Server: SocketServer } = require('socket.io');
const Redis = require('ioredis');
const app = require('./app');

const PORT = parseInt(process.env.NOTIFICATION_PORT || '8001', 10);
const HOST = '0.0.0.0';
const EVENT_CHANNEL = 'cloudvault:events';

const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/socket.io',
});

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Client joins their personal notification room
  socket.on('join_user', (userId) => {
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`[Socket.IO] Client ${socket.id} joined user room: user:${userId}`);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
  });
});

// ─── Redis Pub/Sub Subscriber ────────────────────────────────────────────────
const redisSub = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  lazyConnect: true,
  retryStrategy: (times) => (times > 5 ? null : Math.min(times * 500, 2000)),
});

redisSub.connect().then(() => {
  redisSub.subscribe(EVENT_CHANNEL, (err, count) => {
    if (err) console.warn('[Notification] Failed to subscribe to Redis events:', err.message);
    else console.log(`[Notification] Subscribed to '${EVENT_CHANNEL}' (${count} channels)`);
  });
}).catch((err) => {
  console.warn('[Notification] Redis subscriber not connected:', err.message);
});

redisSub.on('message', (channel, message) => {
  if (channel === EVENT_CHANNEL) {
    try {
      const event = JSON.parse(message);
      console.log(`[Notification] Relaying event '${event.type}'`);

      if (event.payload?.recipient_id) {
        // Send to targeted user
        io.to(`user:${event.payload.recipient_id}`).emit(event.type, event);
      } else {
        // Broadcast to all connected clients
        io.emit(event.type, event);
      }
    } catch (err) {
      console.error('[Notification] Error parsing Redis event:', err.message);
    }
  }
});

module.exports.io = io;

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`[CloudVault Notification] Listening on http://${HOST}:${PORT}`);
  console.log(`[CloudVault Notification] Socket.IO ready at ws://${HOST}:${PORT}/socket.io`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`[CloudVault Notification] ${signal} — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
