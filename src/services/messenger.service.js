'use strict';

const axios = require('axios');

const GRAPH_BASE = 'https://graph.facebook.com';

function graphVersion() {
  return process.env.META_GRAPH_VERSION || 'v26.0';
}

function pageToken() {
  return process.env.META_PAGE_ACCESS_TOKEN || '';
}

function pageId() {
  return process.env.META_PAGE_ID || '';
}

function graphUrl(path) {
  return `${GRAPH_BASE}/${graphVersion()}${path}`;
}

// ─── Wrap Meta API errors ─────────────────────────────────────────────────────

function wrapMetaError(err) {
  const metaError = err.response?.data?.error;
  if (metaError) {
    const e = new Error(`Meta API error ${metaError.code}: ${metaError.message}`);
    e.metaError = metaError;
    e.httpStatus = err.response?.status || 400;
    return e;
  }
  return err;
}

// ─── Send message ─────────────────────────────────────────────────────────────

/**
 * Send a text reply to a Page-Scoped User ID (PSID).
 * Requires: pages_messaging permission.
 */
async function sendMessage(recipientId, text) {
  if (!recipientId || !text) throw new Error('recipientId and text are required');

  const token = pageToken();
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');

  try {
    const response = await axios.post(
      graphUrl('/me/messages'),
      {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { params: { access_token: token } }
    );
    return response.data; // { message_id, recipient_id }
  } catch (err) {
    throw wrapMetaError(err);
  }
}

// ─── Fetch conversations (list) ───────────────────────────────────────────────

/**
 * Fetch Page conversations from Meta.
 * Requires: pages_messaging + pages_read_engagement
 *
 * @param {string} [after]  pagination cursor
 */
async function fetchConversations(after) {
  const token = pageToken();
  const pid = pageId();
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  if (!pid) throw new Error('META_PAGE_ID is not configured');

  const params = {
    fields: 'id,snippet,updated_time,message_count,unread_count,participants',
    platform: 'messenger',
    access_token: token,
    limit: 25,
  };
  if (after) params.after = after;

  try {
    const response = await axios.get(graphUrl(`/${pid}/conversations`), { params });
    return response.data; // { data: [...], paging: {...} }
  } catch (err) {
    throw wrapMetaError(err);
  }
}

// ─── Fetch ONE conversation by Graph conversation ID ──────────────────────────

/**
 * Fetch a single conversation object by its Graph API conversation ID.
 * Requires: pages_messaging + pages_read_engagement
 *
 * @param {string} conversationId  — real Graph conversation ID (e.g. t_123...)
 */
async function fetchConversationById(conversationId) {
  const token = pageToken();
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');

  try {
    const response = await axios.get(graphUrl(`/${conversationId}`), {
      params: {
        fields: 'id,snippet,updated_time,message_count,unread_count,participants',
        access_token: token,
      },
    });
    return response.data;
  } catch (err) {
    throw wrapMetaError(err);
  }
}

// ─── Fetch ALL messages for a conversation (auto-paginate) ────────────────────

/**
 * Fetch every message in a conversation by following all pagination cursors.
 * Requires: pages_messaging + pages_read_engagement
 *
 * ⚠️  conversationId = real Graph conversation ID, NOT the PSID, NOT the message ID.
 *
 * @param {string} conversationId
 * @param {object} [opts]
 * @param {number} [opts.limit=100]     per-page size (max 100)
 * @param {boolean} [opts.allPages=true] auto-follow cursors to get everything
 * @param {string} [opts.after]         start cursor (for manual paging)
 */
async function fetchConversationMessages(conversationId, opts = {}) {
  const token = pageToken();
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');

  const {
    limit = 100,
    allPages = true,
    after,
  } = opts;

  const params = {
    fields: 'id,message,from,to,created_time,attachments{id,mime_type,name,file_url,image_data}',
    access_token: token,
    limit,
  };
  if (after) params.after = after;

  let allMessages = [];
  let nextUrl = graphUrl(`/${conversationId}/messages`);
  let nextParams = params;

  try {
    do {
      const response = await axios.get(nextUrl, { params: nextParams });
      const { data = [], paging } = response.data;

      allMessages = allMessages.concat(data);

      // Follow next cursor only when allPages = true
      if (allPages && paging?.cursors?.after && data.length === limit) {
        // Use the full next URL if provided, else build manually
        nextUrl = paging.next || graphUrl(`/${conversationId}/messages`);
        nextParams = paging.next
          ? {} // already encoded in the next URL
          : { ...params, after: paging.cursors.after };
      } else {
        break;
      }
    } while (true);

    return {
      data: allMessages,
      total: allMessages.length,
    };
  } catch (err) {
    throw wrapMetaError(err);
  }
}

// ─── Fetch user profile ───────────────────────────────────────────────────────

/**
 * Best-effort PSID → name lookup.
 * Returns 'Unknown' silently if permission is missing.
 * Requires: pages_user_locale (optional), pages_messaging
 */
async function fetchUserName(psid) {
  const token = pageToken();
  if (!token || !psid) return 'Unknown';

  try {
    const response = await axios.get(graphUrl(`/${psid}`), {
      params: { fields: 'name', access_token: token },
    });
    return response.data.name || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

module.exports = {
  sendMessage,
  fetchConversations,
  fetchConversationById,
  fetchConversationMessages,
  fetchUserName,
};
