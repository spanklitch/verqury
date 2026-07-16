import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTransport, sendContextEmail } from '../src/mailer.js';

// The context email is a POWERLESS read channel (ADR-0011 Phase C): it carries the full
// question body so the owner can read it on the phone, but never an actionable link and
// never a credential. The answer returns via Telegram, joined by the #code correlation id.

test('sendContextEmail carries the full context, the #code, and no link/secret', async () => {
  const sent = [];
  const fakeTransport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };
  const cfg = { to: 'owner@example.com', from: 'bot@example.com', smtpHost: 'smtp.gmail.com', smtpPort: '465' };
  const body = 'A long decision context.\nParagraph two with the tradeoff.\nParagraph three.';

  await sendContextEmail(fakeTransport, cfg, { code: 'A7B9C1', summary: 'Rename module to relay?', body, project: 'verqury' });

  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.equal(msg.to, 'owner@example.com');
  assert.equal(msg.from, 'bot@example.com');
  assert.match(msg.subject, /#A7B9C1/); // correlation id joins email ⇄ Telegram card
  assert.match(msg.subject, /Rename module to relay\?/);
  assert.ok(msg.text.includes(body)); // FULL context, not a truncated preview
  assert.match(msg.text, /Project: verqury/);
  assert.doesNotMatch(msg.text, /https?:\/\//); // powerless — no actionable link
  const blob = JSON.stringify(msg);
  assert.doesNotMatch(blob, /password|app-password|VERQURY_SMTP/i); // never a credential
});

test('sendContextEmail falls back to From when To is unset', async () => {
  const sent = [];
  const fakeTransport = { sendMail: async (msg) => { sent.push(msg); return {}; } };
  await sendContextEmail(fakeTransport, { from: 'me@example.com' }, { code: 'Z1', summary: 's', body: 'b' });
  assert.equal(sent[0].to, 'me@example.com');
});

test('makeTransport uses implicit TLS on 465 and STARTTLS on 587', () => {
  const t465 = makeTransport({ from: 'me@example.com', smtpHost: 'smtp.gmail.com', smtpPort: '465' }, 'pw');
  assert.equal(t465.options.port, 465);
  assert.equal(t465.options.secure, true);
  const t587 = makeTransport({ from: 'me@example.com', smtpHost: 'smtp.gmail.com', smtpPort: '587' }, 'pw');
  assert.equal(t587.options.port, 587);
  assert.equal(t587.options.secure, false);
});
