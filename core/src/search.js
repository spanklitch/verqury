// SQLite FTS5 search index. This is a DERIVED cache (ADR-0001): the markdown
// files are the source of truth; the index can be deleted and rebuilt at any
// time. Nothing here is authoritative.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { indexPath, projectsDir, globalGuidanceDir, projectPaths, packetsDir } from './paths.js';
import { readDoc } from './frontmatter.js';

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => path.join(dir, n));
}

// Walk the on-disk tree and yield one index row per document. Adding a new
// document type in a later phase is a matter of pushing more files here.
export function collectDocuments(root) {
  const docs = [];
  const push = (file, type, project) => {
    const { data, body } = readDoc(file);
    // Artifacts are usually untitled; fall back to their kind rather than the ulid.
    const title = data.title ?? data.name ?? (type === 'artifact' ? data.kind ?? 'artifact' : path.basename(file, '.md'));
    const tags = Array.isArray(data.tags) ? data.tags.join(' ') : '';
    docs.push({
      path: file,
      type,
      project: project ?? '',
      title: String(title),
      tags,
      body,
      mtime: Math.floor(fs.statSync(file).mtimeMs),
    });
  };

  for (const f of listMd(globalGuidanceDir(root))) push(f, 'guidance', '');
  for (const f of listMd(packetsDir(root))) push(f, 'packet', '');

  const pdir = projectsDir(root);
  if (fs.existsSync(pdir)) {
    for (const d of fs.readdirSync(pdir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = projectPaths(root, d.name);
      if (fs.existsSync(p.file)) push(p.file, 'project', d.name);
      for (const f of listMd(p.guidance)) push(f, 'guidance', d.name);
      for (const f of listMd(p.decisions)) push(f, 'decision', d.name);
      for (const f of listMd(p.log)) push(f, 'log', d.name);
      for (const f of listMd(p.tasks)) push(f, 'task', d.name);
      // Artifacts nest one level deeper (artifacts/YYYY-MM/<ulid>.md).
      if (fs.existsSync(p.artifacts)) {
        for (const month of fs.readdirSync(p.artifacts)) {
          const mdir = path.join(p.artifacts, month);
          if (fs.statSync(mdir).isDirectory()) for (const f of listMd(mdir)) push(f, 'artifact', d.name);
        }
      }
    }
  }
  return docs;
}

function open(root) {
  const db = new Database(indexPath(root));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
    path UNINDEXED, type UNINDEXED, project UNINDEXED, title, tags, body, mtime UNINDEXED
  );`);
  return db;
}

const INSERT_SQL =
  'INSERT INTO documents (path,type,project,title,tags,body,mtime) ' +
  'VALUES (@path,@type,@project,@title,@tags,@body,@mtime)';

// Full rebuild: drop everything and re-scan. Safe after deleting index.sqlite.
export function rebuildIndex(root) {
  const db = open(root);
  try {
    const insert = db.prepare(INSERT_SQL);
    const docs = collectDocuments(root);
    db.transaction((rows) => {
      db.exec('DELETE FROM documents;');
      for (const r of rows) insert.run(r);
    })(docs);
    return docs.length;
  } finally {
    db.close();
  }
}

// Incremental refresh: insert/replace changed files (by mtime), drop removed ones.
export function refreshIndex(root) {
  const db = open(root);
  try {
    const indexed = new Map(
      db.prepare('SELECT path, mtime FROM documents').all().map((r) => [r.path, r.mtime]),
    );
    const docs = collectDocuments(root);
    const onDisk = new Set(docs.map((d) => d.path));
    const del = db.prepare('DELETE FROM documents WHERE path = ?');
    const insert = db.prepare(INSERT_SQL);
    let changed = 0;

    db.transaction(() => {
      for (const d of docs) {
        if (indexed.get(d.path) === d.mtime) continue;
        if (indexed.has(d.path)) del.run(d.path);
        insert.run(d);
        changed++;
      }
      for (const p of indexed.keys()) {
        if (!onDisk.has(p)) { del.run(p); changed++; }
      }
    })();
    return changed;
  } finally {
    db.close();
  }
}

// Full-text search. Optional project/type filters narrow the result set.
export function search(root, query, { project, type, limit = 50 } = {}) {
  if (!query || !String(query).trim()) throw new Error('Search query is required');
  if (!fs.existsSync(indexPath(root))) return [];
  const db = open(root);
  try {
    const clauses = ['documents MATCH ?'];
    const params = [query];
    if (project) { clauses.push('project = ?'); params.push(project); }
    if (type) { clauses.push('type = ?'); params.push(type); }
    return db.prepare(
      `SELECT path, type, project, title,
              snippet(documents, 5, '[', ']', '…', 12) AS snippet, rank
       FROM documents WHERE ${clauses.join(' AND ')} ORDER BY rank LIMIT ?`,
    ).all(...params, limit);
  } finally {
    db.close();
  }
}
