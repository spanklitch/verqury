import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/index.js';

test('verqury-core loads and reports its version', () => {
  assert.equal(VERSION, '0.0.0');
});
