import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('slugify produces kebab-case and drops non-alphanumerics', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  Trim -- Me  '), 'trim-me');
  assert.equal(slugify('ZAGNALS 1.2'), 'zagnals-1-2');
  assert.equal(slugify('Café Déjà'), 'cafe-deja');
  assert.equal(slugify('***'), '');
});
