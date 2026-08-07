// Rendering an AskUserQuestion permission into the relay's card + email channels.
// The fixture mirrors a real recorded payload from approvals/ (two questions, three
// options each, long descriptions) — the exact shape that used to reach the phone as
// a bare "Approve this?" card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAskPayload, askCardText, askEmailBody, TELEGRAM_TEXT_LIMIT } from '../src/ask-card.js';

const PAYLOAD = JSON.stringify({
  questions: [
    {
      question: 'How should I produce the screenshots?',
      header: 'Screenshots',
      options: [
        { label: 'Real app + curated demo data', description: 'Launch a capture instance seeded with fake demo data.' },
        { label: 'shotforge HTML mockups', description: 'Pixel-perfect mockups rendered to PNG.' },
      ],
      multiSelect: false,
    },
    {
      question: 'How do you want to handle videos?',
      header: 'Videos',
      options: [{ label: 'You record', description: 'I write a shot list; you record real flows.' }],
      multiSelect: false,
    },
  ],
});

const meta = { code: 'ABC123', project: 'verqury', sessionId: 'sess-1' };

test('parses questions and options out of an AskUserQuestion payload', () => {
  const digest = parseAskPayload(PAYLOAD);
  assert.equal(digest.length, 2);
  assert.equal(digest[0].question, 'How should I produce the screenshots?');
  assert.equal(digest[0].options.length, 2);
  assert.equal(digest[0].options[1].label, 'shotforge HTML mockups');
});

test('returns null for anything that is not a question payload', () => {
  assert.equal(parseAskPayload('not json at all'), null);
  assert.equal(parseAskPayload(''), null);
  assert.equal(parseAskPayload(undefined), null);
  assert.equal(parseAskPayload(JSON.stringify({ questions: [] })), null);
  assert.equal(parseAskPayload(JSON.stringify({ command: 'ls -la' })), null); // a normal tool permission
});

test('the card carries the question text and option labels, numbered per question', () => {
  const text = askCardText(meta, parseAskPayload(PAYLOAD), false);
  assert.match(text, /Answer needed #ABC123/);
  assert.match(text, /1\. How should I produce the screenshots\?/);
  assert.match(text, /A\) Real app \+ curated demo data/);
  assert.match(text, /B\) shotforge HTML mockups/);
  assert.match(text, /2\. How do you want to handle videos\?/);
  assert.match(text, /📁 verqury/);
  // Descriptions are email-only — they must not bloat the card.
  assert.ok(!text.includes('Pixel-perfect mockups'));
});

test('the card states that answering happens at the desk (the gate is allow/deny only)', () => {
  const text = askCardText(meta, parseAskPayload(PAYLOAD), false);
  assert.match(text, /Approve to answer at your desk/);
});

test('the card notes an emailed long form only when one was sent', () => {
  const digest = parseAskPayload(PAYLOAD);
  assert.match(askCardText(meta, digest, true), /Full options emailed/);
  assert.ok(!askCardText(meta, digest, false).includes('emailed'));
});

test('a huge payload is truncated but keeps its header and footer intact', () => {
  const big = JSON.stringify({
    questions: [{ question: 'Q'.repeat(200), options: Array.from({ length: 60 }, (_, i) => ({ label: `Option ${i} ${'x'.repeat(120)}`, description: 'd' })) }],
  });
  const text = askCardText(meta, parseAskPayload(big), true);
  assert.ok(text.length <= TELEGRAM_TEXT_LIMIT, `card was ${text.length} chars`);
  assert.match(text, /Answer needed #ABC123/);        // header survived
  assert.match(text, /Approve to answer at your desk/); // footer survived
  assert.match(text, /\.\.\./);                          // and it was actually cut
});

test('the email body carries every option WITH its description', () => {
  const body = askEmailBody(parseAskPayload(PAYLOAD));
  assert.match(body, /A\) Real app \+ curated demo data/);
  assert.match(body, /Launch a capture instance seeded with fake demo data\./);
  assert.match(body, /Pixel-perfect mockups rendered to PNG\./);
  assert.match(body, /I write a shot list; you record real flows\./);
});

test('a single question is not numbered', () => {
  const digest = parseAskPayload(JSON.stringify({ questions: [{ question: 'Only one?', options: [] }] }));
  const text = askCardText(meta, digest, false);
  assert.match(text, /Only one\?/);
  assert.ok(!text.includes('1. Only one?'));
});
