'use strict';

const store = require('../store/memory.store');

// Socket.IO instance — set by app.js after boot
let _io = null;
function setIo(io) { _io = io; }

function emit(event, payload) {
  if (_io) _io.emit(event, payload);
}

// Set lưu trữ các update_id đã xử lý để tránh duplicate
const processedUpdateIds = new Set();

// ─── Validate X-Telegram-Bot-Api-Secret-Token header ─────────────────────────

function validateSecret(req, res, next) {
  const incomingSecret = (req.headers['x-telegram-bot-api-secret-token'] || '').trim();
  const expectedSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  if (!expectedSecret) {
    console.error('[telegram] TELEGRAM_WEBHOOK_SECRET is not set in .env');
    return res.status(500).json({ error: 'TELEGRAM_WEBHOOK_SECRET is not configured' });
  }

  if (!incomingSecret || incomingSecret !== expectedSecret) {
    console.warn('[telegram] Webhook secret token validation FAILED');
    return res.sendStatus(403);
  }

  console.log('[telegram] Webhook secret token validated ✓');
  next();
}

// ─── POST /webhooks/telegram ──────────────────────────────────────────────────

async function handleWebhookEvent(req, res) {
  // Acknowledge ngay lập tức với HTTP 200 — Telegram yêu cầu phản hồi nhanh
  res.sendStatus(200);

  const update = req.body;
  if (!update || !update.update_id) {
    console.log('[telegram] Received empty or invalid update object');
    return;
  }

  // Deduplicate theo update_id
  if (processedUpdateIds.has(update.update_id)) {
    console.log(`[telegram] Duplicate update_id ${update.update_id} — skipped`);
    return;
  }
  processedUpdateIds.add(update.update_id);
  // Giữ kích thước Set trong giới hạn hợp lý
  if (processedUpdateIds.size > 2000) {
    const [first] = processedUpdateIds;
    processedUpdateIds.delete(first);
  }

  const msg = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
  if (!msg) {
    console.log('[telegram] Update is not a message (e.g. callback query) — ignored');
    return;
  }

  await processMessage(msg, !!(update.edited_message || update.edited_channel_post));
}

// ─── Process a single Telegram message ───────────────────────────────────────

async function processMessage(msg, isEdited = false) {
  const chat = msg.chat || {};
  const chatId = chat.id;
  const msgId = msg.message_id;
  const from = msg.from || chat;

  if (!chatId || !msgId) {
    console.warn('[telegram] Message missing chat.id or message_id');
    return;
  }

  // Unique IDs
  const conversationId = `tg_${chatId}`;
  const messageStoreId = `tg_msg_${chatId}_${msgId}`;

  if (store.hasMessage(messageStoreId)) {
    console.log(`[telegram] Duplicate messageStoreId ${messageStoreId} — skipped`);
    return;
  }

  // Xác định tên người gửi
  let senderName = 'Unknown User';
  if (from.first_name || from.last_name) {
    senderName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  } else if (from.username) {
    senderName = `@${from.username}`;
  } else if (chat.title) {
    senderName = chat.title;
  } else if (from.id) {
    senderName = `User ${from.id}`;
  }

  // Xử lý đính kèm (Attachments)
  const attachments = [];
  let fallbackText = '';

  if (msg.photo) {
    attachments.push({ type: 'photo', title: 'Photo' });
    fallbackText = '[Photo]';
  } else if (msg.document) {
    const filename = msg.document.file_name || 'File';
    attachments.push({ type: 'document', title: filename });
    fallbackText = `[File: ${filename}]`;
  } else if (msg.video) {
    attachments.push({ type: 'video', title: 'Video' });
    fallbackText = '[Video]';
  } else if (msg.audio) {
    attachments.push({ type: 'audio', title: msg.audio?.title || 'Audio' });
    fallbackText = '[Audio]';
  } else if (msg.voice) {
    attachments.push({ type: 'voice', title: 'Voice message' });
    fallbackText = '[Voice message]';
  } else if (msg.sticker) {
    const emoji = msg.sticker.emoji || '';
    attachments.push({ type: 'sticker', title: emoji ? `Sticker ${emoji}` : 'Sticker' });
    fallbackText = emoji ? `[Sticker ${emoji}]` : '[Sticker]';
  } else if (msg.location) {
    attachments.push({ type: 'location', title: `${msg.location.latitude}, ${msg.location.longitude}` });
    fallbackText = `[Location: ${msg.location.latitude}, ${msg.location.longitude}]`;
  }

  // Nội dung tin nhắn
  const rawText = msg.text || msg.caption || fallbackText || '';
  const displayText = isEdited ? `[edited] ${rawText}` : rawText;

  const stored = store.addMessage({
    id: messageStoreId,
    conversationId,
    externalId: String(chatId), // Telegram chat_id để gửi reply
    senderName,
    text: displayText,
    attachments,
    direction: 'incoming',
    timestamp: (msg.date || Math.floor(Date.now() / 1000)) * 1000,
    platform: 'TELEGRAM',
    raw: {
      message_id: msgId,
      chat_id: chatId,
      from_id: from.id,
      username: from.username,
    },
  });

  if (!stored) return;

  const conversation = store.getConversation(conversationId);

  // Phát sự kiện realtime qua Socket.IO
  emit('message:new', stored);
  emit('conversation:updated', conversation);

  console.log(`[telegram] Received message from "${senderName}" (chat ${chatId}): "${displayText.slice(0, 40)}"`);
}

module.exports = {
  setIo,
  validateSecret,
  handleWebhookEvent,
  processMessage,
};
