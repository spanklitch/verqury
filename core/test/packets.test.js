import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpRoot } from './helpers.js';
import { createProject } from '../src/projects.js';
import { addGuidance } from '../src/guidance.js';
import { addLog } from '../src/memory.js';
import { listPackets, showPacket, addPacket, renderPacket } from '../src/packets.js';

test('init seeds the three starter packets', () => {
  const root = tmpRoot();
  assert.deepEqual(listPackets(root).map((p) => p.slug).sort(), ['browser-task', 'chat-ideation', 'terminal-build']);
});

test('renderPacket expands project vars, includes, and recent log', () => {
  const root = tmpRoot();
  createProject(root, { name: 'Portal', stage: 'build', repo: '/home/x/portal' });
  addGuidance(root, { title: 'Security Baseline', kind: 'standard', body: '# Security Baseline\n\nNo hardcoded secrets.' });
  addLog(root, 'portal', { text: 'wired the API', title: 'API done' });

  const { text, output } = renderPacket(root, 'terminal-build', 'portal');
  assert.match(text, /# Portal — build context/);
  assert.match(text, /Stage: build/);
  assert.match(text, /No hardcoded secrets\./); // included guidance body
  assert.match(text, /API done/); // recent log entry
  assert.equal(output, '/home/x/portal/VERQURY_CONTEXT.md'); // output path resolved from repo
});

test('log:N marker limits the number of entries', () => {
  const root = tmpRoot();
  createProject(root, { name: 'P' });
  for (let i = 1; i <= 6; i++) addLog(root, 'p', { text: `entry ${i}`, title: `E${i}` });
  addPacket(root, { title: 'Two Logs', slug: 'two-logs', body: '{{log:2}}' });
  const { text } = renderPacket(root, 'two-logs', 'p');
  assert.equal((text.match(/^- /gm) || []).length, 2);
});

test('unknown markers are left intact; missing project/packet throw', () => {
  const root = tmpRoot();
  createProject(root, { name: 'P' });
  addPacket(root, { title: 'Odd', slug: 'odd', body: 'keep {{mystery}} here' });
  assert.match(renderPacket(root, 'odd', 'p').text, /\{\{mystery\}\}/);
  assert.throws(() => renderPacket(root, 'odd', 'ghost'), /No such project/);
  assert.throws(() => showPacket(root, 'nope'), /No such packet/);
});
