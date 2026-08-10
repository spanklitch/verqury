import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOtelReceiver } from '../src/otel-receiver.js';

const post = (port, body, path = '/v1/metrics') =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

test('accepts an OTLP post and hands the raw body to the ingest callback', async () => {
  const seen = [];
  const rx = createOtelReceiver({ port: 0, onPayload: (b) => seen.push(b) });
  const port = await rx.start();
  const res = await post(port, '{"resourceMetrics":[]}');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{}'); // OTLP wants a JSON body back
  assert.deepEqual(seen, ['{"resourceMetrics":[]}']);
  await rx.stop();
  assert.equal(rx.running, false);
});

test('a throwing ingest never takes the listener down', async () => {
  const rx = createOtelReceiver({ port: 0, onPayload: () => { throw new Error('bad payload'); } });
  const port = await rx.start();
  assert.equal((await post(port, 'garbage')).status, 200);
  assert.equal((await post(port, '{}')).status, 200); // still serving
  await rx.stop();
});

test('non-POST gets a flat 404 — the port describes nothing about itself', async () => {
  const rx = createOtelReceiver({ port: 0, onPayload: () => {} });
  const port = await rx.start();
  const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`);
  assert.equal(res.status, 404);
  await rx.stop();
});

test('a port already in use degrades to null instead of throwing', async () => {
  // The receiver is optional by design: a collision must cost the meter its numbers,
  // never stop Verqury from starting.
  const first = createOtelReceiver({ port: 0, onPayload: () => {} });
  const port = await first.start();
  const second = createOtelReceiver({ port, onPayload: () => {} });
  assert.equal(await second.start(), null);
  assert.equal(second.running, false);
  await first.stop();
});

test('an oversized body is rejected rather than buffered', async () => {
  const seen = [];
  const rx = createOtelReceiver({ port: 0, onPayload: (b) => seen.push(b) });
  const port = await rx.start();
  const res = await post(port, 'x'.repeat(5 * 1024 * 1024)).catch((e) => e);
  assert.ok(res instanceof Error || res.status === 413);
  assert.deepEqual(seen, []); // nothing was handed to ingest
  await rx.stop();
});
