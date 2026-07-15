// Minimal Telegram Bot API client for the remote decision relay (ADR-0011, Phase B).
// Electron-free (plain node https) so it stays unit-testable. The Verqury app is the
// SINGLE consumer of getUpdates — Telegram's long-poll is a single-consumer queue, so
// the app owns it and the hook only reads/writes files (see hooks/verqury-permission).
// The bot token is passed in per call and never stored, logged, or returned.
import https from 'node:https';

function api(token, method, payload, { timeoutMs = 10000 } = {}) {
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            resolve({ ok: false });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('telegram timeout')));
    req.write(body);
    req.end();
  });
}

// Send a message with an inline [✅ Approve][⛔ Deny] keyboard. callback_data carries
// the approval id so a tap routes to the right pending decision (concurrent tabs).
export function sendApprovalCard(token, chatId, text, id) {
  return api(token, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `a:${id}` },
        { text: '⛔ Deny', callback_data: `d:${id}` },
      ]],
    },
  });
}

export function sendMessage(token, chatId, text) {
  return api(token, 'sendMessage', { chat_id: chatId, text });
}

// Replace a resolved card's text and drop its buttons so it can't be tapped twice.
export function editMessageText(token, chatId, messageId, text) {
  return api(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } });
}

export function answerCallbackQuery(token, callbackQueryId, text) {
  return api(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

// Long-poll for updates. `timeoutS` is the server-side hold; the socket timeout is a
// few seconds beyond it. Single-consumer — only the app calls this.
export function getUpdates(token, offset, { timeoutS = 50 } = {}) {
  return api(token, 'getUpdates', { offset, timeout: timeoutS, allowed_updates: ['callback_query'] }, { timeoutMs: (timeoutS + 10) * 1000 });
}
