// Thin, consistent wrapper over gray-matter so every doc reads/writes the same way.
import fs from 'node:fs';
import matter from 'gray-matter';

export function readDoc(file) {
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  return { data, body: content };
}

export function writeDoc(file, data, body = '') {
  fs.writeFileSync(file, matter.stringify(body ?? '', data));
}
