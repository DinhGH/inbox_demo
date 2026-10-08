'use strict';

/**
 * In-Memory Message Store
 *
 * ⚠️  All data is lost when the server restarts.
 *
 * Conversation shape:
 *   {
 *     id          : string  — unique conversation ID
 *     externalId  : string  — platform-native ID (chat_id for Telegram, PSID for Messenger)
 *     senderName  : string  — customer display name
 *     lastMessage : string
 *     lastUpdated : number  — Unix ms
 *     platform    : 'MESSENGER' | 'TELEGRAM'
 *     unreadCount : number
 *   }
 *
 * Message shape:
 *   {
 *     id             : string   — unique message ID (dedup key)
 *     conversationId : string
 *     externalId     : string   — platform-native sender/chat ID
 *     senderName     : string
 *     text           : string
 *     attachments    : Array
 *     direction      : 'incoming' | 'outgoing'
 *     timestamp      : number   — Unix ms
 *     platform       : 'MESSENGER' | 'TELEGRAM'
 *   }
 */

// conversationId → conversation object
const conversations = new Map();

// messageId → message object (deduplication)
const messagesById = new Map();

// conversationId → ordered array of messages
const messagesByConversation = new Map();

// ─── Conversations ────────────────────────────────────────────────────────────

function upsertConversation(conv) {
  const existing = conversations.get(conv.id) || {};
  
  // Xác định senderName: không ghi đè tên khách hàng bằng 'Bot' hoặc 'Page'
  let safeSenderName = conv.senderName || existing.senderName || 'Unknown';
  if ((safeSenderName === 'Bot' || safeSenderName === 'Page') && existing.senderName && existing.senderName !== 'Unknown') {
    safeSenderName = existing.senderName;
  }

  const updated = {
    platform: 'MESSENGER',
    unreadCount: 0,
    externalId: '',
    ...existing,
    ...conv,
    senderName: safeSenderName,
    lastUpdated: conv.lastUpdated || Date.now(),
  };

  conversations.set(updated.id, updated);
  return updated;
}

function getConversation(id) {
  return conversations.get(id) || null;
}

function getAllConversations() {
  return Array.from(conversations.values()).sort(
    (a, b) => b.lastUpdated - a.lastUpdated
  );
}

/**
 * Filter conversations by platform.
 * @param {'MESSENGER'|'TELEGRAM'|'ALL'} platform
 */
function getConversationsByPlatform(platform) {
  if (!platform || platform === 'ALL') return getAllConversations();
  return getAllConversations().filter(
    (c) => (c.platform || 'MESSENGER').toUpperCase() === platform.toUpperCase()
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────

function addMessage(msg) {
  if (messagesById.has(msg.id)) return null; // dedup

  const message = {
    attachments: [],
    senderName: 'Unknown',
    text: '',
    platform: 'MESSENGER',
    timestamp: Date.now(),
    externalId: '',
    direction: 'incoming',
    ...msg,
  };

  messagesById.set(message.id, message);

  const list = messagesByConversation.get(message.conversationId) || [];
  list.push(message);
  messagesByConversation.set(message.conversationId, list);

  // Giữ thông tin tóm tắt conversation luôn được cập nhật
  const existingConv = conversations.get(message.conversationId);
  const convSenderName = (message.direction === 'outgoing' && existingConv?.senderName && existingConv.senderName !== 'Unknown')
    ? existingConv.senderName
    : (message.direction === 'incoming' ? message.senderName : (existingConv?.senderName || message.senderName));

  upsertConversation({
    id: message.conversationId,
    externalId: message.externalId || existingConv?.externalId || '',
    senderName: convSenderName,
    lastMessage: message.text || '[attachment]',
    lastUpdated: message.timestamp,
    platform: message.platform || existingConv?.platform || 'MESSENGER',
  });

  return message;
}

function getMessage(id) {
  return messagesById.get(id) || null;
}

function getMessagesForConversation(conversationId) {
  return (messagesByConversation.get(conversationId) || []).slice();
}

function getAllMessages() {
  return Array.from(messagesById.values()).sort(
    (a, b) => b.timestamp - a.timestamp
  );
}

function hasMessage(id) {
  return messagesById.has(id);
}

function getStats() {
  const byPlatform = { MESSENGER: 0, TELEGRAM: 0 };
  for (const c of conversations.values()) {
    const plat = (c.platform || 'MESSENGER').toUpperCase();
    byPlatform[plat] = (byPlatform[plat] || 0) + 1;
  }
  return {
    conversations: conversations.size,
    messages: messagesById.size,
    byPlatform,
  };
}

module.exports = {
  upsertConversation,
  getConversation,
  getAllConversations,
  getConversationsByPlatform,
  addMessage,
  getMessage,
  getMessagesForConversation,
  getAllMessages,
  hasMessage,
  getStats,
};
