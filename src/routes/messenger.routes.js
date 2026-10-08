'use strict';

const express = require('express');
const router = express.Router();
const store = require('../store/memory.store');
const messengerService = require('../services/messenger.service');

// Socket.IO instance — injected after init
let _io = null;
function setIo(io) { _io = io; }

// ─── Helper: map Graph API message → store shape ──────────────────────────────

function mapGraphMessage(msg, conversationId, pageId) {
  const fromId = msg.from?.id;
  const direction = fromId === pageId ? 'outgoing' : 'incoming';
  const psid = direction === 'incoming'
    ? fromId
    : (msg.to?.data?.[0]?.id || '');

  return {
    id: msg.id,
    conversationId,
    psid,
    senderName: msg.from?.name || 'Unknown',
    text: msg.message || '',
    attachments: (msg.attachments?.data || []).map((a) => ({
      type: a.mime_type || 'unknown',
      url: a.file_url || a.image_data?.url || null,
      title: a.name || null,
      id: a.id || null,
    })),
    direction,
    timestamp: msg.created_time ? new Date(msg.created_time).getTime() : Date.now(),
    platform: 'MESSENGER',
  };
}

// ─── Helper: map Graph API conversation → store shape ────────────────────────

function mapGraphConversation(conv, pageIdStr) {
  const participants = (conv.participants?.data || []).filter(
    (p) => p.id !== pageIdStr
  );
  const customer = participants[0];
  return {
    id: conv.id,
    psid: customer?.id || '',
    senderName: customer?.name || 'Unknown',
    lastMessage: conv.snippet || '',
    messageCount: conv.message_count || 0,
    unreadCount: conv.unread_count || 0,
    lastUpdated: conv.updated_time ? new Date(conv.updated_time).getTime() : Date.now(),
  };
}

// ─── GET /api/health ──────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    memory: store.getStats(),
    graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
    pageId: process.env.META_PAGE_ID || '(not set)',
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/messages ────────────────────────────────────────────────────────
// Lấy TẤT CẢ messages trong memory store (tất cả conversations).
// Query params:
//   conversationId  — lọc theo conversation cụ thể (optional)
//   direction       — 'incoming' | 'outgoing' (optional)

router.get('/messages', (req, res) => {
  const { conversationId, direction } = req.query;

  let messages = store.getAllMessages(); // newest first

  if (conversationId) {
    messages = messages.filter((m) => m.conversationId === conversationId);
  }
  if (direction) {
    messages = messages.filter((m) => m.direction === direction);
  }

  res.json({
    count: messages.length,
    messages,
  });
});

// ─── POST /api/messages/send ──────────────────────────────────────────────────
// Body: { recipientId, text }
// Cần quyền: pages_messaging

router.post('/messages/send', async (req, res) => {
  const { recipientId, text } = req.body;

  if (!recipientId || typeof recipientId !== 'string') {
    return res.status(400).json({ error: 'recipientId là bắt buộc và phải là string' });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text là bắt buộc và không được rỗng' });
  }

  try {
    const apiResponse = await messengerService.sendMessage(recipientId, text.trim());

    const pageId = process.env.META_PAGE_ID || 'page';
    const conversationId = `${pageId}_${recipientId}`;

    const stored = store.addMessage({
      id: apiResponse.message_id,
      conversationId,
      psid: recipientId,
      senderName: 'Page',
      text: text.trim(),
      attachments: [],
      direction: 'outgoing',
      timestamp: Date.now(),
      platform: 'MESSENGER',
    });

    const conversation = store.getConversation(conversationId);

    if (stored && _io) {
      _io.emit('message:new', stored);
      _io.emit('conversation:updated', conversation);
    }

    console.log(`[api] Message sent to PSID ${recipientId} — mid: ${apiResponse.message_id}`);
    res.json({ success: true, messageId: apiResponse.message_id });
  } catch (err) {
    console.error('[api] Send message failed:', err.message);
    if (err.metaError) {
      return res.status(err.httpStatus || 400).json({
        error: err.message,
        code: err.metaError.code,
        type: err.metaError.type,
        hint: getPermissionHint(err.metaError.code),
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/conversations ───────────────────────────────────────────────────
// Lấy danh sách conversations từ Meta Graph API + merge vào local store.
// Cần quyền: pages_messaging, pages_read_engagement
// Query params:
//   after  — cursor phân trang

router.get('/conversations', async (req, res) => {
  const local = store.getAllConversations();
  const pageId = process.env.META_PAGE_ID || '';

  try {
    const data = await messengerService.fetchConversations(req.query.after);

    for (const conv of data.data || []) {
      store.upsertConversation(mapGraphConversation(conv, pageId));
    }

    res.json({
      conversations: store.getAllConversations(),
      paging: data.paging || null,
    });
  } catch (err) {
    console.error('[api] fetchConversations error:', err.message);
    res.json({
      conversations: local,
      error: err.message,
      hint: getPermissionHint(err.metaError?.code),
      paging: null,
    });
  }
});

// ─── GET /api/conversations/:id ───────────────────────────────────────────────
// Lấy thông tin 1 conversation cụ thể.

router.get('/conversations/:id', async (req, res) => {
  const conversationId = req.params.id;
  const pageId = process.env.META_PAGE_ID || '';

  // Thử lấy từ local store trước
  const localConv = store.getConversation(conversationId);

  // Nếu là Telegram conversation, trả về local store luôn
  if (conversationId.startsWith('tg_') || localConv?.platform === 'TELEGRAM') {
    return res.json({ conversation: localConv });
  }

  try {
    const data = await messengerService.fetchConversationById(conversationId);
    const conv = mapGraphConversation(data, pageId);
    store.upsertConversation(conv);

    res.json({ conversation: store.getConversation(conversationId) });
  } catch (err) {
    console.error(`[api] fetchConversationById error for ${conversationId}:`, err.message);
    if (err.metaError) {
      return res.status(err.httpStatus || 400).json({
        error: err.message,
        code: err.metaError.code,
        hint: getPermissionHint(err.metaError.code),
        conversation: localConv, // trả local nếu có
      });
    }
    res.json({
      conversation: localConv,
      error: err.message,
    });
  }
});

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
// Lấy TẤT CẢ messages của một conversation.
// Với Telegram: lấy từ in-memory store.
// Với Messenger: lấy từ Meta (auto-paginate) và lưu vào store.

router.get('/conversations/:id/messages', async (req, res) => {
  const conversationId = req.params.id;
  const pageId = process.env.META_PAGE_ID || '';

  // Xử lý trực tiếp cho Telegram
  if (conversationId.startsWith('tg_') || store.getConversation(conversationId)?.platform === 'TELEGRAM') {
    const stored = store.getMessagesForConversation(conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);
    return res.json({
      conversationId,
      total: stored.length,
      platform: 'TELEGRAM',
      messages: stored,
    });
  }

  const allPages = req.query.allPages !== 'false'; // mặc định tự động paginate
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 100);
  const after = req.query.after || undefined;

  try {
    const data = await messengerService.fetchConversationMessages(conversationId, {
      limit,
      allPages,
      after,
    });

    // Hydrate store với messages từ Graph API
    let newCount = 0;
    for (const msg of data.data) {
      if (!store.hasMessage(msg.id)) {
        store.addMessage(mapGraphMessage(msg, conversationId, pageId));
        newCount++;
      }
    }

    // Lấy messages đã lưu trong store (bao gồm cả webhook messages)
    const stored = store.getMessagesForConversation(conversationId)
      .sort((a, b) => a.timestamp - b.timestamp); // cũ → mới

    console.log(
      `[api] conversations/${conversationId}/messages — fetched ${data.total} from Meta, ${newCount} new, ${stored.length} in store`
    );

    res.json({
      conversationId,
      total: stored.length,
      fetchedFromMeta: data.total,
      messages: stored,
    });
  } catch (err) {
    console.error(`[api] fetchConversationMessages error for ${conversationId}:`, err.message);

    // Luôn trả messages local nếu có
    const stored = store.getMessagesForConversation(conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (err.metaError) {
      return res.status(err.httpStatus || 400).json({
        conversationId,
        total: stored.length,
        messages: stored,
        error: err.message,
        code: err.metaError.code,
        type: err.metaError.type,
        hint: getPermissionHint(err.metaError.code),
      });
    }

    res.json({
      conversationId,
      total: stored.length,
      messages: stored,
      error: err.message,
    });
  }
});

// ─── GET /api/conversations/:id/messages/all ─────────────────────────────────
// Alias rõ ràng hơn để lấy tất cả (không cần truyền query param)

router.get('/conversations/:id/messages/all', async (req, res) => {
  req.query.allPages = 'true';
  // Chuyển về route cha bằng cách gọi thẳng logic
  const conversationId = req.params.id;
  const pageId = process.env.META_PAGE_ID || '';

  try {
    const data = await messengerService.fetchConversationMessages(conversationId, {
      limit: 100,
      allPages: true,
    });

    let newCount = 0;
    for (const msg of data.data) {
      if (!store.hasMessage(msg.id)) {
        store.addMessage(mapGraphMessage(msg, conversationId, pageId));
        newCount++;
      }
    }

    const stored = store.getMessagesForConversation(conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);

    res.json({
      conversationId,
      total: stored.length,
      fetchedFromMeta: data.total,
      newStored: newCount,
      messages: stored,
    });
  } catch (err) {
    console.error(`[api] /all error for ${conversationId}:`, err.message);
    const stored = store.getMessagesForConversation(conversationId)
      .sort((a, b) => a.timestamp - b.timestamp);

    res.status(err.httpStatus || 500).json({
      conversationId,
      total: stored.length,
      messages: stored,
      error: err.message,
      code: err.metaError?.code,
      hint: getPermissionHint(err.metaError?.code),
    });
  }
});

// ─── Dev-only: simulate an incoming message ───────────────────────────────────
// Bật bằng ENABLE_SIMULATED_MESSAGES=true trong .env

router.post('/dev/simulate', (req, res) => {
  if (process.env.ENABLE_SIMULATED_MESSAGES !== 'true') {
    return res.status(404).json({ error: 'Simulation endpoint is disabled' });
  }

  const { senderName = 'Test User', text = 'Hello from simulation!' } = req.body;
  const psid = `sim_${Date.now()}`;
  const pageId = process.env.META_PAGE_ID || 'page';
  const conversationId = `${pageId}_${psid}`;
  const mid = `sim_mid_${Date.now()}`;

  const stored = store.addMessage({
    id: mid,
    conversationId,
    psid,
    senderName: `[SIMULATED] ${senderName}`,
    text,
    attachments: [],
    direction: 'incoming',
    timestamp: Date.now(),
    platform: 'MESSENGER',
    simulated: true,
  });

  const conversation = store.getConversation(conversationId);

  if (_io) {
    _io.emit('message:new', stored);
    _io.emit('conversation:updated', conversation);
  }

  console.log('[dev] Simulated message broadcast');
  res.json({ success: true, message: stored });
});

// ─── Helper: gợi ý permission dựa trên Meta error code ───────────────────────

function getPermissionHint(code) {
  const hints = {
    10: 'Thiếu quyền pages_messaging. Vào Meta App Dashboard → Permissions → Thêm pages_messaging.',
    100: 'Sai tham số hoặc ID không tồn tại. Kiểm tra lại conversation ID.',
    190: 'Access token hết hạn hoặc không hợp lệ. Tạo lại Page Access Token.',
    200: 'Thiếu quyền pages_read_engagement hoặc pages_messaging_subscriptions. Xem hướng dẫn bên dưới.',
    230: 'Vi phạm chính sách messaging (gửi ngoài 24h window).',
    613: 'Rate limit. Thử lại sau vài giây.',
  };
  return code ? (hints[code] || `Xem tài liệu Meta: https://developers.facebook.com/docs/messenger-platform/error-codes`) : null;
}

module.exports = { router, setIo };
