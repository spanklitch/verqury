import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('renders headings, emphasis, and inline code', () => {
  assert.match(renderMarkdown('# Title'), /<h1>Title<\/h1>/);
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown('*em*'), /<em>em<\/em>/);
  assert.match(renderMarkdown('use `code` here'), /<code>code<\/code>/);
});

test('renders lists, fenced code, links, and hr', () => {
  assert.match(renderMarkdown('- a\n- b'), /<ul>\n<li>a<\/li>\n<li>b<\/li>\n<\/ul>/);
  assert.match(renderMarkdown('1. one\n2. two'), /<ol>\n<li>one<\/li>/);
  assert.match(renderMarkdown('```\nx=1\n```'), /<pre><code>x=1<\/code><\/pre>/);
  assert.match(renderMarkdown('[site](https://example.com)'), /<a href="https:\/\/example\.com">site<\/a>/);
  assert.match(renderMarkdown('---'), /<hr>/);
});

test('escapes HTML so content cannot inject markup', () => {
  const out = renderMarkdown('a <script>alert(1)</script> b');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test('non-http links are not turned into anchors', () => {
  const out = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(out, /<a /);
});
