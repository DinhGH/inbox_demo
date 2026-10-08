"use strict";

const crypto = require("crypto");
const store = require("../store/memory.store");
const messengerService = require("../services/messenger.service");

// Socket.IO instance — set once during app bootstrap
let _io = null;

function setIo(io) {
  _io = io;
}

// ─── Emit helpers ────────────────────────────────────────────────────────────

function emit(event, payload) {
  if (_io) _io.emit(event, payload);
}

// ─── GET /webhooks/messenger — challenge verification ────────────────────────

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // console.log("DEBUG WEBHOOK:", {
  //   mode,
  //   receivedTokenLength: token?.length,
  //   envTokenLoaded: !!process.env.META_VERIFY_TOKEN,
  //   envTokenLength: process.env.META_VERIFY_TOKEN?.length,
  //   tokenMatched: token === process.env.META_VERIFY_TOKEN,
  //   cwd: process.cwd(),
  // });

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    console.log("[webhook] Verify token matched — returning challenge");
    return res.status(200).send(challenge);
  }

  console.warn("[webhook] Verify token mismatch or wrong mode");
  return res.sendStatus(403);
}

// ─── Signature validation ────────────────────────────────────────────────────

/**
 * Validate the X-Hub-Signature-256 header against the raw request body.
 * Rejects any request that fails HMAC verification.
 *
 * ⚠️  rawBody must be populated by express.raw() before this middleware runs.
 */
function validateSignature(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];

  if (!signature) {
    console.warn("[webhook] Missing X-Hub-Signature-256 header");
    return res.sendStatus(403);
  }

  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error(
      "[webhook] META_APP_SECRET is not set — cannot verify signature",
    );
    return res.sendStatus(500);
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );

  if (!valid) {
    console.warn("[webhook] Signature validation FAILED");
    return res.sendStatus(403);
  }

  console.log("[webhook] Signature validated ✓");
  next();
}

// ─── POST /webhooks/messenger — incoming event handler ───────────────────────

async function handleWebhookEvent(req, res) {
  // Acknowledge immediately — Meta expects 200 within 5 s
  res.sendStatus(200);

  const body = req.body;

  if (body.object !== "page") {
    console.log("[webhook] Received non-page event — ignoring", body.object);
    return;
  }

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      await processMessagingEvent(event);
    }
  }
}

// ─── Core event processor ────────────────────────────────────────────────────

async function processMessagingEvent(event) {
  const { sender, recipient, message, timestamp } = event;

  if (!sender || !message) {
    // Not a message event we care about (delivery, read, etc.)
    return;
  }

  const psid = sender.id;
  const pageId = recipient.id;

  // Message echoes — sent BY the page, not TO it
  if (message.is_echo) {
    console.log(`[webhook] Echo message — mid: ${message.mid}`);
    await handleEchoMessage(event, pageId);
    return;
  }

  console.log(
    `[webhook] Incoming message from PSID ${psid} — mid: ${message.mid}`,
  );

  // Deduplication
  if (store.hasMessage(message.mid)) {
    console.log(`[webhook] Duplicate mid ${message.mid} — skipped`);
    return;
  }

  // Best-effort name lookup
  const senderName = await messengerService.fetchUserName(psid);

  // Use PSID as a stable conversation key (one conversation per user per page)
  const conversationId = `${pageId}_${psid}`;

  const attachments = (message.attachments || []).map((a) => ({
    type: a.type,
    url: a.payload?.url || null,
    title: a.payload?.title || null,
  }));

  const stored = store.addMessage({
    id: message.mid,
    conversationId,
    psid,
    senderName,
    text: message.text || "",
    attachments,
    direction: "incoming",
    timestamp: timestamp || Date.now(),
    platform: "MESSENGER",
  });

  if (!stored) {
    return; // another concurrent handler won the race
  }

  const conversation = store.getConversation(conversationId);

  emit("message:new", stored);
  emit("conversation:updated", conversation);

  console.log(`[webhook] Message stored and broadcast — mid: ${message.mid}`);
}

// ─── Echo handler (outgoing messages sent via page) ──────────────────────────

async function handleEchoMessage(event, pageId) {
  const { sender, recipient, message, timestamp } = event;
  const mid = message.mid;

  if (store.hasMessage(mid)) return;

  // For echoes: sender = page, recipient = customer
  const psid = recipient.id;
  const conversationId = `${pageId}_${psid}`;

  const attachments = (message.attachments || []).map((a) => ({
    type: a.type,
    url: a.payload?.url || null,
    title: a.payload?.title || null,
  }));

  const stored = store.addMessage({
    id: mid,
    conversationId,
    psid,
    senderName: "Page",
    text: message.text || "",
    attachments,
    direction: "outgoing",
    timestamp: timestamp || Date.now(),
    platform: "MESSENGER",
  });

  if (stored) {
    const conversation = store.getConversation(conversationId);
    emit("message:new", stored);
    emit("conversation:updated", conversation);
  }
}

module.exports = {
  setIo,
  verifyWebhook,
  validateSignature,
  handleWebhookEvent,
};
