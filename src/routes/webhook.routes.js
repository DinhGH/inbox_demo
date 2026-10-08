'use strict';

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// ─── GET /webhooks/messenger ─────────────────────────────────────────────────
// Meta calls this once when you configure or update the webhook callback URL.
router.get('/messenger', webhookController.verifyWebhook);

// ─── POST /webhooks/messenger ────────────────────────────────────────────────
// Meta calls this for every subscribed event (messages, echoes, etc.).
// The raw body middleware is applied in app.js so the signature can be verified.
router.post(
  '/messenger',
  webhookController.validateSignature,
  webhookController.handleWebhookEvent
);

module.exports = router;

