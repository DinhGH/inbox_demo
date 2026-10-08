/* public/app.js — Unified Inbox: Messenger & Telegram */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedConversationId  = null;
  let selectedPlatform        = null;  // 'MESSENGER' | 'TELEGRAM'
  let selectedExternalId      = null;  // chatId (TG) or PSID (Messenger)
  let activeFilterPlatform    = 'ALL';
  let allConversations        = [];    // full list from server
  const renderedMessageIds    = new Set();

  // ── DOM References ─────────────────────────────────────────────────────────
  const socketDot          = document.getElementById('socket-dot');
  const socketLabel        = document.getElementById('socket-label');
  const stateMessenger     = document.getElementById('state-messenger');
  const stateTelegram      = document.getElementById('state-telegram');
  const badgeMessenger     = document.getElementById('badge-messenger');
  const badgeTelegram      = document.getElementById('badge-telegram');
  const tgWebhookVal       = document.getElementById('tg-webhook-val');
  const btnToggleWebhook   = document.getElementById('btn-toggle-webhook');
  const webhookPanel       = document.getElementById('webhook-panel');
  const btnCloseWebhook    = document.getElementById('btn-close-webhook');
  const inputWebhookUrl    = document.getElementById('input-webhook-url');
  const btnSaveWebhook     = document.getElementById('btn-save-webhook');
  const btnCheckWebhook    = document.getElementById('btn-check-webhook');
  const webhookFeedback    = document.getElementById('webhook-feedback');
  const btnSimulateTg      = document.getElementById('btn-simulate-tg');
  const convList           = document.getElementById('conv-list');
  const chatEmpty          = document.getElementById('chat-empty');
  const chatView           = document.getElementById('chat-view');
  const chatName           = document.getElementById('chat-name');
  const chatMeta           = document.getElementById('chat-meta');
  const chatPlatformBadge  = document.getElementById('chat-platform-badge');
  const messageList        = document.getElementById('message-list');
  const msgLoading         = document.getElementById('msg-loading');
  const msgEmpty           = document.getElementById('msg-empty');
  const replyForm          = document.getElementById('reply-form');
  const replyInput         = document.getElementById('reply-input');
  const btnSend            = document.getElementById('btn-send');
  const btnRefresh         = document.getElementById('btn-refresh');
  const sendError          = document.getElementById('send-error');

  // ── Utilities ──────────────────────────────────────────────────────────────
  function formatTime(ts) {
    const d = new Date(Number(ts));
    if (isNaN(d)) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(ts) {
    const d = new Date(Number(ts));
    if (isNaN(d)) return '';
    return d.toDateString() === new Date().toDateString()
      ? formatTime(ts)
      : d.toLocaleDateString();
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scrollBottom() {
    messageList.scrollTop = messageList.scrollHeight;
  }

  function showSendError(msg) {
    sendError.textContent = msg;
    sendError.classList.remove('hidden');
    setTimeout(() => sendError.classList.add('hidden'), 6000);
  }

  // ── Socket.IO Realtime ─────────────────────────────────────────────────────
  const socket = io();

  socket.on('connect', () => {
    socketDot.className = 'dot dot-connected';
    socketLabel.textContent = 'Đã kết nối Socket.IO';
    console.log('[socket] Connected:', socket.id);
  });

  socket.on('disconnect', () => {
    socketDot.className = 'dot dot-disconnected';
    socketLabel.textContent = 'Mất kết nối Socket.IO';
    console.log('[socket] Disconnected');
  });

  socket.on('connect_error', () => {
    socketDot.className = 'dot dot-disconnected';
    socketLabel.textContent = 'Lỗi kết nối Socket.IO';
  });

  socket.on('message:new', (msg) => {
    console.log('[socket] message:new received:', msg);

    // Cập nhật cuộc hội thoại trong danh sách
    const conv = allConversations.find((c) => c.id === msg.conversationId);
    if (conv) {
      conv.lastMessage = msg.text || '[attachment]';
      conv.lastUpdated = msg.timestamp;
      // Sắp xếp lại danh sách
      allConversations.sort((a, b) => b.lastUpdated - a.lastUpdated);
      renderConvList();
    } else {
      // Nếu hội thoại mới chưa có trong danh sách, thêm vào
      const newConv = {
        id: msg.conversationId,
        externalId: msg.externalId || '',
        senderName: msg.senderName,
        lastMessage: msg.text || '[attachment]',
        lastUpdated: msg.timestamp,
        platform: msg.platform || 'MESSENGER',
      };
      upsertConvLocal(newConv);
      renderConvList();
    }

    // Nếu hội thoại hiện tại đang được mở, render tin nhắn mới ngay
    if (msg.conversationId === selectedConversationId) {
      appendMessage(msg);
      scrollBottom();
    }
  });

  socket.on('conversation:updated', (conv) => {
    console.log('[socket] conversation:updated:', conv);
    upsertConvLocal(conv);
    renderConvList();
  });

  // ── Conversation List Management ───────────────────────────────────────────

  function upsertConvLocal(conv) {
    const idx = allConversations.findIndex((c) => c.id === conv.id);
    if (idx >= 0) {
      allConversations[idx] = { ...allConversations[idx], ...conv };
    } else {
      allConversations.unshift(conv);
    }
    allConversations.sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  function getFilteredConvs() {
    if (activeFilterPlatform === 'ALL') return allConversations;
    return allConversations.filter(
      (c) => (c.platform || 'MESSENGER').toUpperCase() === activeFilterPlatform
    );
  }

  function renderConvList() {
    const filtered = getFilteredConvs();
    convList.innerHTML = '';

    if (filtered.length === 0) {
      convList.innerHTML = '<div class="empty-state">Chưa có hội thoại nào.<br/><small>Gửi tin nhắn qua Messenger hoặc Telegram để bắt đầu.</small></div>';
      return;
    }

    filtered.forEach((conv) => {
      const isTg = (conv.platform || '').toUpperCase() === 'TELEGRAM';
      const isActive = conv.id === selectedConversationId;

      const item = document.createElement('div');
      item.className = `conv-item${isActive ? ' active' : ''}${isTg && isActive ? ' tg' : ''}`;
      item.id = `conv-${conv.id}`;

      const avatarEmoji = isTg ? '✈️' : '💬';
      const avatarClass = isTg ? 'telegram' : 'messenger';
      const simBadge = conv.simulated ? '<span class="conv-badge">SIM</span>' : '';

      item.innerHTML = `
        <div class="conv-avatar ${avatarClass}">${avatarEmoji}</div>
        <div class="conv-content">
          <div class="conv-name">${esc(conv.senderName || 'Unknown')}${simBadge}</div>
          <div class="conv-snippet">${esc(conv.lastMessage || '')}</div>
          <div class="conv-time">${formatDate(conv.lastUpdated)}</div>
        </div>
      `;
      item.addEventListener('click', () => openConversation(conv));
      convList.appendChild(item);
    });
  }

  // ── Open a Conversation ───────────────────────────────────────────────────

  async function openConversation(conv) {
    selectedConversationId = conv.id;
    selectedPlatform       = (conv.platform || 'MESSENGER').toUpperCase();
    selectedExternalId     = conv.externalId || conv.psid || '';

    // Cập nhật active trong danh sách
    document.querySelectorAll('.conv-item').forEach((el) => {
      el.classList.remove('active', 'tg');
    });
    const item = document.getElementById(`conv-${conv.id}`);
    if (item) {
      item.classList.add('active');
      if (selectedPlatform === 'TELEGRAM') item.classList.add('tg');
    }

    // Hiển thị khung chat
    chatEmpty.style.display = 'none';
    chatView.classList.remove('hidden');

    chatName.textContent = conv.senderName || 'Unknown';
    chatMeta.textContent = selectedPlatform === 'TELEGRAM'
      ? `Telegram chat_id: ${conv.externalId || '—'}`
      : `Page PSID: ${conv.externalId || conv.psid || '—'}`;

    chatPlatformBadge.textContent = selectedPlatform === 'TELEGRAM' ? '✈️ Telegram' : '💬 Messenger';
    chatPlatformBadge.className = `chat-platform-label ${selectedPlatform}`;

    btnSend.style.background = selectedPlatform === 'TELEGRAM' ? '#2AABEE' : '#1877f2';

    // Xóa tin nhắn cũ và tải tin nhắn mới
    messageList.innerHTML = '';
    renderedMessageIds.clear();
    msgLoading.classList.remove('hidden');
    msgEmpty.classList.add('hidden');
    messageList.appendChild(msgLoading);

    await loadMessages(conv);
  }

  async function loadMessages(conv) {
    try {
      const url = `/api/conversations/${encodeURIComponent(conv.id)}/messages`;
      const res  = await fetch(url);
      const data = await res.json();

      msgLoading.classList.add('hidden');

      const msgs = (data.messages || []).sort((a, b) => a.timestamp - b.timestamp);

      if (msgs.length === 0) {
        msgEmpty.textContent = data.error
          ? `Không tải được tin nhắn: ${data.error}`
          : 'Chưa có tin nhắn nào trong hội thoại này.';
        msgEmpty.classList.remove('hidden');
        messageList.appendChild(msgEmpty);
        return;
      }

      msgs.forEach(appendMessage);
      scrollBottom();
    } catch (err) {
      console.error('[loadMessages] error:', err);
      msgLoading.classList.add('hidden');
      msgEmpty.textContent = 'Lỗi khi tải tin nhắn.';
      msgEmpty.classList.remove('hidden');
    }
  }

  // ── Render a Message Bubble ────────────────────────────────────────────────

  function appendMessage(msg) {
    if (renderedMessageIds.has(msg.id)) return;
    renderedMessageIds.add(msg.id);

    msgEmpty.classList.add('hidden');

    const platformClass = (msg.platform || selectedPlatform || 'MESSENGER').toUpperCase();
    const wrapper = document.createElement('div');
    wrapper.className = `msg-wrapper ${msg.direction} ${platformClass}`;
    if (msg.simulated) wrapper.classList.add('msg-simulated');
    wrapper.id = `msg-${msg.id}`;

    const senderHtml = msg.direction === 'incoming'
      ? `<div class="msg-sender">${esc(msg.senderName || 'Unknown')}</div>` : '';

    const attachHtml = (msg.attachments || [])
      .map((a) => `<div class="msg-attachment">📎 ${esc(a.type)}${a.title ? ': ' + esc(a.title) : ''}</div>`)
      .join('');

    const simLabel = msg.simulated
      ? '<div class="msg-time" style="color:#f0a500">[SIMULATED]</div>' : '';

    wrapper.innerHTML = `
      ${senderHtml}
      <div class="msg-bubble">${esc(msg.text || '')}${attachHtml}</div>
      <div class="msg-time">${formatTime(msg.timestamp)}</div>
      ${simLabel}
    `;

    messageList.appendChild(wrapper);
  }

  // ── Send Reply ─────────────────────────────────────────────────────────────

  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = replyInput.value.trim();
    if (!text || !selectedExternalId) return;

    btnSend.disabled = true;
    btnSend.textContent = 'Đang gửi…';
    sendError.classList.add('hidden');

    try {
      let url, body;

      if (selectedPlatform === 'TELEGRAM') {
        url  = '/api/telegram/send';
        body = { chatId: selectedExternalId, text };
      } else {
        url  = '/api/messages/send';
        body = { recipientId: selectedExternalId, text };
      }

      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      replyInput.value = '';
    } catch (err) {
      console.error('[send] error:', err);
      showSendError(err.message || 'Không gửi được tin nhắn');
    } finally {
      btnSend.disabled = false;
      btnSend.textContent = 'Gửi';
    }
  });

  replyInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      replyForm.dispatchEvent(new Event('submit'));
    }
  });

  // ── Filter Tabs ────────────────────────────────────────────────────────────

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilterPlatform = btn.dataset.platform;
      renderConvList();
    });
  });

  // ── Telegram Webhook Management ───────────────────────────────────────────

  async function checkTelegramWebhook() {
    try {
      const res = await fetch('/api/telegram/webhook-info');
      const data = await res.json();
      if (data.ok && data.result) {
        const info = data.result;
        if (info.url) {
          tgWebhookVal.textContent = 'Đã kết nối';
          tgWebhookVal.className = 'tg-webhook-val ok';
          tgWebhookVal.title = `URL: ${info.url}\nChờ xử lý: ${info.pending_update_count || 0}`;
          inputWebhookUrl.value = info.url;
        } else {
          tgWebhookVal.textContent = 'Chưa thiết lập';
          tgWebhookVal.className = 'tg-webhook-val warn';
          tgWebhookVal.title = 'Chưa cài đặt webhook Telegram';
        }
      } else {
        tgWebhookVal.textContent = 'Chưa bật token';
        tgWebhookVal.className = 'tg-webhook-val warn';
      }
    } catch {
      tgWebhookVal.textContent = 'Lỗi kiểm tra';
      tgWebhookVal.className = 'tg-webhook-val warn';
    }
  }

  btnToggleWebhook.addEventListener('click', () => {
    webhookPanel.classList.toggle('hidden');
    if (!webhookPanel.classList.contains('hidden')) {
      inputWebhookUrl.focus();
    }
  });

  btnCloseWebhook.addEventListener('click', () => {
    webhookPanel.classList.add('hidden');
  });

  btnSaveWebhook.addEventListener('click', async () => {
    const url = inputWebhookUrl.value.trim();
    if (!url) {
      showWebhookFeedback('Vui lòng nhập URL ngrok (https://...)', false);
      return;
    }

    btnSaveWebhook.disabled = true;
    btnSaveWebhook.textContent = 'Đang lưu…';

    try {
      const res = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Lỗi cài đặt webhook');
      }

      showWebhookFeedback(`✓ Đã đăng ký thành công: ${data.webhookUrl}`, true);
      await checkTelegramWebhook();
    } catch (err) {
      showWebhookFeedback(`Lỗi: ${err.message}`, false);
    } finally {
      btnSaveWebhook.disabled = false;
      btnSaveWebhook.textContent = 'Lưu Webhook';
    }
  });

  btnCheckWebhook.addEventListener('click', async () => {
    await checkTelegramWebhook();
    try {
      const res = await fetch('/api/telegram/webhook-info');
      const data = await res.json();
      if (data.ok && data.result) {
        const info = data.result;
        const msg = info.url
          ? `URL: ${info.url}\nPending: ${info.pending_update_count || 0}${info.last_error_message ? '\nLỗi gần nhất: ' + info.last_error_message : ''}`
          : 'Webhook hiện tại đang trống (URL rỗng).';
        showWebhookFeedback(msg, !!info.url);
      }
    } catch (err) {
      showWebhookFeedback(`Lỗi: ${err.message}`, false);
    }
  });

  function showWebhookFeedback(text, isSuccess) {
    webhookFeedback.textContent = text;
    webhookFeedback.className = `webhook-feedback ${isSuccess ? 'success' : 'error'}`;
    webhookFeedback.classList.remove('hidden');
  }

  // ── Simulate Telegram Message ──────────────────────────────────────────────

  btnSimulateTg.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/telegram/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: '8839982963',
          senderName: 'Test Telegram User',
          text: `Xin chào! Đây là tin nhắn thử nghiệm lúc ${new Date().toLocaleTimeString()}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[simulate] Telegram simulated message created');
      }
    } catch (err) {
      console.error('[simulate] error:', err);
    }
  });

  // ── Initial Data Load ──────────────────────────────────────────────────────

  async function checkPlatforms() {
    // Check Messenger
    try {
      const res  = await fetch('/api/health');
      const data = await res.json();
      if (data.pageId && data.pageId !== '(not set)') {
        stateMessenger.textContent = `Page ${data.pageId}`;
        badgeMessenger.classList.add('ok');
      } else {
        stateMessenger.textContent = 'Chưa cài đặt';
      }
    } catch {
      stateMessenger.textContent = 'Lỗi kết nối';
    }

    // Check Telegram Bot
    try {
      const res  = await fetch('/api/telegram/me');
      const data = await res.json();
      if (data.ok && data.bot) {
        stateTelegram.textContent = `@${data.bot.username}`;
        badgeTelegram.classList.add('ok');
      } else {
        stateTelegram.textContent = 'Chưa cài đặt';
      }
    } catch {
      stateTelegram.textContent = 'Lỗi kết nối';
    }

    // Check Telegram Webhook
    await checkTelegramWebhook();
  }

  async function loadConversations() {
    try {
      const res  = await fetch('/api/conversations');
      const data = await res.json();
      (data.conversations || []).forEach(upsertConvLocal);
    } catch (err) {
      console.warn('[loadConversations] error:', err.message);
    }

    // Tải thêm tin nhắn trong memory store để chắc chắn không sót hội thoại
    try {
      const res  = await fetch('/api/messages');
      const data = await res.json();
      const convMap = {};
      for (const msg of data.messages || []) {
        if (!convMap[msg.conversationId]) {
          convMap[msg.conversationId] = {
            id: msg.conversationId,
            externalId: msg.externalId || '',
            senderName: msg.senderName,
            lastMessage: msg.text || '[attachment]',
            lastUpdated: msg.timestamp,
            platform: msg.platform || 'MESSENGER',
          };
        } else if (msg.timestamp > convMap[msg.conversationId].lastUpdated) {
          convMap[msg.conversationId].lastMessage = msg.text || '[attachment]';
          convMap[msg.conversationId].lastUpdated = msg.timestamp;
        }
      }
      Object.values(convMap).forEach(upsertConvLocal);
    } catch (err) {
      console.warn('[loadConversations] messages fallback error:', err.message);
    }

    renderConvList();
  }

  btnRefresh.addEventListener('click', () => {
    allConversations = [];
    convList.innerHTML = '<div class="empty-state">Đang làm mới…</div>';
    loadConversations();
    checkPlatforms();
  });

  // Boot
  checkPlatforms();
  loadConversations();

})();
