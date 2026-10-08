'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store/memory.store');
const telegramService = require('../services/telegram.service');

let _io = null;
function setIo(io) { _io = io; }

// ─── POST /api/telegram/send ──────────────────────────────────────────────────
// Gửi tin nhắn từ website đến user Telegram qua Bot API.
// Body: { chatId: string|number, text: string }

router.post('/telegram/send', async (req, res) => {
  const { chatId, text } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId là bắt buộc' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'text là bắt buộc và không được rỗng' });
  }

  const cleanText = String(text).trim();

  try {
    const result = await telegramService.sendMessage(chatId, cleanText);
    const sentMsg = result.result; // Telegram message object

    const conversationId = `tg_${chatId}`;
    const messageStoreId = `tg_msg_${chatId}_${sentMsg.message_id}`;

    const stored = store.addMessage({
      id: messageStoreId,
      conversationId,
      externalId: String(chatId),
      senderName: 'Bot',
      text: cleanText,
      attachments: [],
      direction: 'outgoing',
      timestamp: Date.now(),
      platform: 'TELEGRAM',
      raw: { message_id: sentMsg.message_id, chat_id: chatId },
    });

    const conversation = store.getConversation(conversationId);

    if (stored && _io) {
      _io.emit('message:new', stored);
      _io.emit('conversation:updated', conversation);
    }

    console.log(`[api/telegram] Sent message to chat ${chatId} — msg_id: ${sentMsg.message_id}`);
    res.json({ success: true, messageId: sentMsg.message_id, conversationId });
  } catch (err) {
    console.error('[api/telegram] send error:', err.message);
    if (err.tgError) {
      return res.status(err.httpStatus || 400).json({
        error: err.message,
        code: err.tgError.error_code,
        description: err.tgError.description,
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/telegram/webhook-info ──────────────────────────────────────────
// Kiểm tra trạng thái webhook hiện tại trên Telegram servers.

router.get('/telegram/webhook-info', async (req, res) => {
  try {
    const info = await telegramService.getWebhookInfo();
    res.json(info);
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message });
  }
});

// ─── POST /api/telegram/set-webhook ──────────────────────────────────────────
// Đăng ký webhook với Telegram.
// Body: { url: string }
// Hỗ trợ cả domain gốc (https://xxx.ngrok-free.app) hoặc full path (.../webhooks/telegram)

router.post('/telegram/set-webhook', async (req, res) => {
  const url = req.body.url || process.env.AUTO_WEBHOOK_URL;
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  if (!url) {
    return res.status(400).json({
      error: 'Vui lòng cung cấp URL trong body { url: "https://xxx.ngrok-free.dev" }',
    });
  }

  try {
    const result = await telegramService.setWebhook(url, secret);
    console.log(`[api/telegram] Webhook configured successfully → ${result.webhookUrl}`);
    res.json({
      success: true,
      webhookUrl: result.webhookUrl,
      result: result.result || result,
    });
  } catch (err) {
    console.error('[api/telegram] set-webhook error:', err.message);
    res.status(err.httpStatus || 500).json({
      error: err.message,
      details: err.tgError || null,
    });
  }
});

// ─── DELETE /api/telegram/webhook ────────────────────────────────────────────
// Xoá webhook đăng ký trên Telegram.

router.delete('/telegram/webhook', async (req, res) => {
  try {
    const result = await telegramService.deleteWebhook();
    res.json({ success: true, result });
  } catch (err) {
    res.status(err.httpStatus || 500).json({ error: err.message });
  }
});

// ─── GET /api/telegram/me ─────────────────────────────────────────────────────
// Kiểm tra thông tin bot token.

router.get('/telegram/me', async (req, res) => {
  try {
    const me = await telegramService.getMe();
    res.json({ ok: true, bot: me });
  } catch (err) {
    res.status(err.httpStatus || 500).json({
      ok: false,
      error: err.message,
    });
  }
});

// ─── POST /api/telegram/simulate ─────────────────────────────────────────────
// Endpoint giả lập tin nhắn Telegram đến (dành cho test local khi chưa có ngrok)

router.post('/telegram/simulate', (req, res) => {
  const {
    chatId = '123456789',
    senderName = 'Telegram Tester',
    text = 'Xin chào từ Telegram Test!',
  } = req.body;

  const conversationId = `tg_${chatId}`;
  const messageStoreId = `tg_sim_${chatId}_${Date.now()}`;

  const stored = store.addMessage({
    id: messageStoreId,
    conversationId,
    externalId: String(chatId),
    senderName: `[TG-SIM] ${senderName}`,
    text: String(text).trim(),
    attachments: [],
    direction: 'incoming',
    timestamp: Date.now(),
    platform: 'TELEGRAM',
    simulated: true,
  });

  const conversation = store.getConversation(conversationId);

  if (_io) {
    _io.emit('message:new', stored);
    _io.emit('conversation:updated', conversation);
  }

  console.log(`[api/telegram] Simulated message generated for chat ${chatId}`);
  res.json({ success: true, message: stored, conversation });
});

module.exports = { router, setIo };
