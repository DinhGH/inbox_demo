'use strict';

const express = require('express');
const router = express.Router();
const telegramController = require('../controllers/telegram.controller');

// ─── POST /webhooks/telegram ──────────────────────────────────────────────────
// Telegram gọi endpoint này khi có tin nhắn mới.
// Header X-Telegram-Bot-Api-Secret-Token phải khớp với TELEGRAM_WEBHOOK_SECRET.

router.post(
  '/telegram',
  telegramController.validateSecret,
  telegramController.handleWebhookEvent
);

module.exports = router;

