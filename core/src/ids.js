// ULID generation (deferred here from Phase 1 — first consumer is artifacts).
// 26-char Crockford base32: a 10-char millisecond timestamp prefix (lexically
// sortable by time) + 16 chars of randomness. Dependency-free (crypto is stdlib).
import { randomBytes } from 'node:crypto';

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(t) {
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENC[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom() {
  const bytes = randomBytes(RAND_LEN);
  let out = '';
  for (let i = 0; i < RAND_LEN; i++) out += ENC[bytes[i] % 32];
  return out;
}

export function ulid(time = Date.now()) {
  return encodeTime(time) + encodeRandom();
}
