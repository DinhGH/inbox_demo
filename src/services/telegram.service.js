'use strict';

const axios = require('axios');

function botToken() {
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function apiBase() {
  const token = botToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return `https://api.telegram.org/bot${token}`;
}

// ─── Register webhook with Telegram ──────────────────────────────────────────

/**
 * POST https://api.telegram.org/bot{token}/setWebhook
 *
 * @param {string} url            — public HTTPS URL (e.g. ngrok URL)
 * @param {string} secretToken    — TELEGRAM_WEBHOOK_SECRET value
 */
async function setWebhook(url, secretToken) {
  if (!url) throw new Error('URL is required to set Telegram webhook');

  // Chuẩn hóa URL: đảm bảo có đuôi /webhooks/telegram và không bị trùng lặp
  let webhookUrl = url.trim().replace(/\/+$/, '');
  if (!webhookUrl.endsWith('/webhooks/telegram')) {
    webhookUrl = `${webhookUrl}/webhooks/telegram`;
  }

  const payload = {
    url: webhookUrl,
    allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
    drop_pending_updates: false,
  };

  if (secretToken && secretToken.trim()) {
    payload.secret_token = secretToken.trim();
  }

  try {
    const response = await axios.post(`${apiBase()}/setWebhook`, payload);
    return {
      ...response.data,
      webhookUrl,
    };
  } catch (err) {
    const tgError = err.response?.data;
    if (tgError) {
      const e = new Error(`Telegram API error ${tgError.error_code}: ${tgError.description}`);
      e.tgError = tgError;
      e.httpStatus = err.response?.status || 400;
      throw e;
    }
    throw err;
  }
}

/**
 * GET current webhook info.
 */
async function getWebhookInfo() {
  try {
    const response = await axios.get(`${apiBase()}/getWebhookInfo`);
    return response.data;
  } catch (err) {
    const tgError = err.response?.data;
    if (tgError) {
      const e = new Error(`Telegram API error ${tgError.error_code}: ${tgError.description}`);
      e.tgError = tgError;
      e.httpStatus = err.response?.status || 400;
      throw e;
    }
    throw err;
  }
}

/**
 * DELETE webhook (chuyển về polling mode nếu cần).
 */
async function deleteWebhook() {
  try {
    const response = await axios.post(`${apiBase()}/deleteWebhook`, {
      drop_pending_updates: false,
    });
    return response.data;
  } catch (err) {
    const tgError = err.response?.data;
    if (tgError) {
      const e = new Error(`Telegram API error ${tgError.error_code}: ${tgError.description}`);
      e.tgError = tgError;
      e.httpStatus = err.response?.status || 400;
      throw e;
    }
    throw err;
  }
}

// ─── Send a reply to a Telegram chat ─────────────────────────────────────────

/**
 * Send a text message to a Telegram chat.
 *
 * Lưu ý quan trọng:
 * Không ép parse_mode: 'HTML' cho tin nhắn thông thường vì các ký tự
 * như <, >, & của người dùng gõ vào sẽ làm Telegram báo lỗi 400 (Bad Request: can't parse entities).
 *
 * @param {string|number} chatId  — Telegram chat_id
 * @param {string} text
 * @param {object} [options]
 */
async function sendMessage(chatId, text, options = {}) {
  if (!chatId || !text) throw new Error('chatId and text are required');

  const body = {
    chat_id: chatId,
    text: String(text).trim(),
  };

  if (options.replyToId) {
    body.reply_to_message_id = options.replyToId;
  }

  if (options.parseMode) {
    body.parse_mode = options.parseMode;
  }

  try {
    const response = await axios.post(`${apiBase()}/sendMessage`, body);
    return response.data; // { ok, result: { message_id, ... } }
  } catch (err) {
    const tgError = err.response?.data;
    if (tgError) {
      const e = new Error(`Telegram API error ${tgError.error_code}: ${tgError.description}`);
      e.tgError = tgError;
      e.httpStatus = err.response?.status || 400;
      throw e;
    }
    throw err;
  }
}

// ─── Get bot info ─────────────────────────────────────────────────────────────

async function getMe() {
  try {
    const response = await axios.get(`${apiBase()}/getMe`);
    return response.data.result;
  } catch (err) {
    const tgError = err.response?.data;
    if (tgError) {
      const e = new Error(`Telegram API error ${tgError.error_code}: ${tgError.description}`);
      e.tgError = tgError;
      e.httpStatus = err.response?.status || 400;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  setWebhook,
  getWebhookInfo,
  deleteWebhook,
  sendMessage,
  getMe,
};
