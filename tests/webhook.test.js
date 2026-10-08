'use strict';

/**
 * Tests for Meta & Telegram webhook verification and message handling.
 *
 * Run with:  npm test
 * Requires:  Node.js 20+ (built-in test runner)
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

// ── Provide minimal env before loading the app ──────────────────────────────

process.env.PORT                    = '5099';
process.env.META_APP_SECRET         = 'test_secret_for_unit_tests_only';
process.env.META_VERIFY_TOKEN       = 'test_verify_token';
process.env.META_PAGE_ID            = '123456789';
process.env.META_PAGE_ACCESS_TOKEN  = 'EAAB_test_token';
process.env.META_GRAPH_VERSION      = 'v26.0';
process.env.TELEGRAM_BOT_TOKEN      = '8839982963:AAFvfp6hSeAQInnjO0PINc-vXd_UkbFnk8o';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_tg_secret';

const { app, server: appServer } = require('../src/app');

// ── Helpers ──────────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const BASE = { host: 'localhost', port: 5099 };

before(() =>
  new Promise((resolve) => {
    appServer.listen(5099, resolve);
  })
);

// ── Webhook GET — Meta challenge verification ────────────────────────────────

describe('GET /webhooks/messenger — verification', () => {
  test('returns challenge when token matches', async () => {
    const result = await request({
      ...BASE,
      method: 'GET',
      path: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=my_challenge_123',
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'my_challenge_123');
  });

  test('returns 403 when token does not match', async () => {
    const result = await request({
      ...BASE,
      method: 'GET',
      path: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=abc',
    });
    assert.equal(result.statusCode, 403);
  });

  test('returns 403 when mode is not subscribe', async () => {
    const result = await request({
      ...BASE,
      method: 'GET',
      path: '/webhooks/messenger?hub.mode=unsubscribe&hub.verify_token=test_verify_token&hub.challenge=abc',
    });
    assert.equal(result.statusCode, 403);
  });

  test('returns 403 when token is missing', async () => {
    const result = await request({
      ...BASE,
      method: 'GET',
      path: '/webhooks/messenger?hub.mode=subscribe&hub.challenge=abc',
    });
    assert.equal(result.statusCode, 403);
  });
});

// ── Webhook POST — Meta signature validation ─────────────────────────────────

describe('POST /webhooks/messenger — signature validation', () => {
  function buildSignature(payload, secret) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  const validPayload = JSON.stringify({
    object: 'page',
    entry: [{
      id: '123456789',
      time: Date.now(),
      messaging: [{
        sender: { id: 'psid_001' },
        recipient: { id: '123456789' },
        timestamp: Date.now(),
        message: { mid: `mid_test_${Date.now()}`, text: 'Hello test' },
      }],
    }],
  });

  test('accepts request with valid signature', async () => {
    const sig = buildSignature(validPayload, 'test_secret_for_unit_tests_only');
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/messenger',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': sig,
          'Content-Length': Buffer.byteLength(validPayload),
        },
      },
      validPayload
    );
    assert.equal(result.statusCode, 200);
  });

  test('rejects request with wrong signature', async () => {
    const sig = buildSignature(validPayload, 'totally_wrong_secret');
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/messenger',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': sig,
          'Content-Length': Buffer.byteLength(validPayload),
        },
      },
      validPayload
    );
    assert.equal(result.statusCode, 403);
  });

  test('rejects request with missing signature header', async () => {
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/messenger',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(validPayload),
        },
      },
      validPayload
    );
    assert.equal(result.statusCode, 403);
  });

  test('rejects request with tampered payload', async () => {
    const originalSig = buildSignature(validPayload, 'test_secret_for_unit_tests_only');
    const tamperedPayload = validPayload.replace('Hello test', 'Injected content');

    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/messenger',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': originalSig,
          'Content-Length': Buffer.byteLength(tamperedPayload),
        },
      },
      tamperedPayload
    );
    assert.equal(result.statusCode, 403);
  });
});

// ── Webhook POST — Telegram secret & message handling ─────────────────────────

describe('POST /webhooks/telegram — secret validation & message handling', () => {
  const sampleUpdate = JSON.stringify({
    update_id: 999901,
    message: {
      message_id: 42,
      from: {
        id: 777888999,
        first_name: 'Nguyen',
        last_name: 'Van A',
        username: 'nguyenvana',
      },
      chat: {
        id: 777888999,
        first_name: 'Nguyen',
        last_name: 'Van A',
        type: 'private',
      },
      date: 1712571234,
      text: 'Xin chào bot!',
    },
  });

  test('rejects request with missing X-Telegram-Bot-Api-Secret-Token', async () => {
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/telegram',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(sampleUpdate),
        },
      },
      sampleUpdate
    );
    assert.equal(result.statusCode, 403);
  });

  test('rejects request with incorrect secret token', async () => {
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/telegram',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret',
          'Content-Length': Buffer.byteLength(sampleUpdate),
        },
      },
      sampleUpdate
    );
    assert.equal(result.statusCode, 403);
  });

  test('accepts request with valid secret token and stores message', async () => {
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/webhooks/telegram',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'test_tg_secret',
          'Content-Length': Buffer.byteLength(sampleUpdate),
        },
      },
      sampleUpdate
    );
    assert.equal(result.statusCode, 200);

    // Kiểm tra tin nhắn đã được lưu vào memory store
    const checkRes = await request({
      ...BASE,
      method: 'GET',
      path: '/api/conversations/tg_777888999/messages',
    });
    assert.equal(checkRes.statusCode, 200);
    const data = JSON.parse(checkRes.body);
    assert.equal(data.platform, 'TELEGRAM');
    assert.ok(data.messages.length >= 1);
    const found = data.messages.find((m) => m.text === 'Xin chào bot!');
    assert.ok(found, 'Should find the stored Telegram message');
    assert.equal(found.senderName, 'Nguyen Van A');
  });
});

// ── Health endpoint ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const result = await request({ ...BASE, method: 'GET', path: '/api/health' });
    assert.equal(result.statusCode, 200);
    const data = JSON.parse(result.body);
    assert.equal(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number');
  });
});

// ── Simulation endpoints ──────────────────────────────────────────────────────

describe('POST /api/dev/simulate', () => {
  test('returns 404 when simulation is disabled (default)', async () => {
    const body = JSON.stringify({ text: 'test sim' });
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/api/dev/simulate',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      body
    );
    assert.equal(result.statusCode, 404);
  });
});

describe('POST /api/telegram/simulate', () => {
  test('creates a simulated telegram message', async () => {
    const body = JSON.stringify({ chatId: '999111', text: 'Simulated TG test' });
    const result = await request(
      {
        ...BASE,
        method: 'POST',
        path: '/api/telegram/simulate',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      body
    );
    assert.equal(result.statusCode, 200);
    const data = JSON.parse(result.body);
    assert.equal(data.success, true);
    assert.equal(data.message.platform, 'TELEGRAM');
  });
});
