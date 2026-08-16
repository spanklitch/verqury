import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pollFailed, nextRelayBackoff, RELAY_BACKOFF_MIN_MS, RELAY_BACKOFF_MAX_MS,
} from '../src/telegram.js';

// The regression these pin: api() resolves ANY HTTP status as a fulfilled promise, so a
// rejected long-poll never throws and a `catch`-only backoff is unreachable. An invalid
// token spun the relay loop for 15 h (engineering-notes §17).

test('a rejected poll is recognised as a failure, however it arrives', () => {
  assert.equal(pollFailed({ ok: false, error_code: 401, description: 'Unauthorized' }), true);
  assert.equal(pollFailed({ ok: false }), true); // api()'s own unparseable-body shape
  assert.equal(pollFailed(null), true);
  assert.equal(pollFailed(undefined), true);
  assert.equal(pollFailed({}), true); // no ok field at all
  assert.equal(pollFailed({ ok: 'true' }), true); // truthy but not literally true
});

test('a healthy poll is not a failure, even with an empty result', () => {
  assert.equal(pollFailed({ ok: true, result: [] }), false);
  assert.equal(pollFailed({ ok: true, result: [{ update_id: 1 }] }), false);
});

test('backoff starts at the floor and doubles, never past the ceiling', () => {
  let ms = nextRelayBackoff(0); // first failure after a healthy poll
  assert.equal(ms, RELAY_BACKOFF_MIN_MS);
  ms = nextRelayBackoff(ms);
  assert.equal(ms, RELAY_BACKOFF_MIN_MS * 2);
  ms = nextRelayBackoff(ms);
  assert.equal(ms, RELAY_BACKOFF_MIN_MS * 4);
  for (let i = 0; i < 20; i++) ms = nextRelayBackoff(ms);
  assert.equal(ms, RELAY_BACKOFF_MAX_MS); // caps rather than growing without bound
});

test('Telegram\'s own retry_after wins over the ladder, and is still capped', () => {
  const res429 = { ok: false, error_code: 429, parameters: { retry_after: 30 } };
  assert.equal(nextRelayBackoff(0, res429), 30_000);
  assert.equal(nextRelayBackoff(RELAY_BACKOFF_MIN_MS * 8, res429), 30_000); // overrides, not adds
  // A hostile or absurd retry_after cannot park the relay for an hour.
  assert.equal(nextRelayBackoff(0, { parameters: { retry_after: 99999 } }), RELAY_BACKOFF_MAX_MS);
  // Nonsense values fall back to the ladder rather than producing NaN.
  for (const bad of [0, -5, 'soon', null, undefined, NaN]) {
    assert.equal(nextRelayBackoff(0, { parameters: { retry_after: bad } }), RELAY_BACKOFF_MIN_MS);
  }
});

test('a 401 does not get special-cased into an infinite wait', () => {
  // A bad token is recoverable at runtime: saving a new one bumps relayGen and starts a
  // fresh loop at zero backoff. So 401 rides the ordinary ladder — capped, not parked.
  const res401 = { ok: false, error_code: 401, description: 'Unauthorized' };
  let ms = 0;
  for (let i = 0; i < 30; i++) ms = nextRelayBackoff(ms, res401);
  assert.equal(ms, RELAY_BACKOFF_MAX_MS);
  assert.ok(ms > 0 && Number.isFinite(ms));
});
