'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const webhookRoutes        = require('./routes/webhook.routes');
const telegramWebhookRoutes = require('./routes/telegram.webhook.routes');
const messengerRoutes      = require('./routes/messenger.routes');
const telegramRoutes       = require('./routes/telegram.routes');
const webhookController    = require('./controllers/webhook.controller');
const telegramController   = require('./controllers/telegram.controller');

// ─── App & HTTP server ───────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: { origin: '*' },
});

// Share io with all controllers/routes that emit events
webhookController.setIo(io);
telegramController.setIo(io);
messengerRoutes.setIo(io);
telegramRoutes.setIo(io);

io.on('connection', (socket) => {
  console.log(`[socket.io] Client connected — id: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[socket.io] Client disconnected — id: ${socket.id}`);
  });
});

// ─── Body parsing ────────────────────────────────────────────────────────────
// Capture raw body before JSON parsing (needed for Meta HMAC verification).
// Telegram uses X-Telegram-Bot-Api-Secret-Token (plain string, no HMAC) so
// raw body is not strictly required, but we keep the same middleware for both.

app.use((req, res, next) => {
  express.raw({ type: 'application/json' })(req, res, (err) => {
    if (err) return next(err);
    if (req.body && Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        req.body = {};
      }
    }
    next();
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── Static files ────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Routes ──────────────────────────────────────────────────────────────────

// Webhooks (inbound from Meta / Telegram)
app.use('/webhooks', webhookRoutes);           // GET+POST /webhooks/messenger
app.use('/webhooks', telegramWebhookRoutes);   // POST     /webhooks/telegram

// API (called by the frontend)
app.use('/api', messengerRoutes.router);       // /api/conversations, /api/messages, ...
app.use('/api', telegramRoutes.router);        // /api/telegram/send, /api/telegram/me, ...

// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Global error handler ────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[app] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '5000', 10);

  server.listen(PORT, () => {
    console.log(`\n🚀  Server listening on http://localhost:${PORT}`);
    console.log(`📡  Messenger webhook : http://localhost:${PORT}/webhooks/messenger`);
    console.log(`📡  Telegram webhook  : http://localhost:${PORT}/webhooks/telegram`);
    console.log(`🔍  Health            : http://localhost:${PORT}/api/health`);
    console.log(`🤖  Telegram bot      : http://localhost:${PORT}/api/telegram/me`);
    console.log(`   Meta Graph version: ${process.env.META_GRAPH_VERSION || 'v26.0'}`);
    console.log(`   Facebook Page ID  : ${process.env.META_PAGE_ID || '(not set)'}\n`);
  });
}

module.exports = { app, server, io };

