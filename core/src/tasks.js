// Task router: tasks flow to a route (direct / automation / browser-agent /
// human), get handed off with a rendered payload, and close by attaching a
// captured report — which echoes a log entry back into project memory. This is
// where packets (Phase 5) and artifacts (Phase 4) meet. Pure file I/O (ADR-0001).
// Stored per-project at projects/<slug>/tasks/<ulid>.md.
import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from './paths.js';
import { readDoc, writeDoc } from './frontmatter.js';
import { ulid } from './ids.js';
import { listProjects } from './projects.js';
import { getActiveProject } from './config.js';
import { addLog } from './memory.js';
import { listPackets, renderPacket } from './packets.js';
import { TASK_ROUTES, TASK_STATUSES, assertEnum } from './schema.js';

function ensureProject(root, slug) {
  const p = projectPaths(root, slug);
  if (!fs.existsSync(p.file)) throw new Error(`No such project: ${slug}`);
  return p;
}

function taskFile(root, projectSlug, id) {
  const file = path.join(projectPaths(root, projectSlug).tasks, `${id}.md`);
  return fs.existsSync(file) ? file : null;
}

export function addTask(root, projectSlug, { title, route = 'direct', stage = null, surface = null, body = '', resume = false } = {}) {
  if (!title || !String(title).trim()) throw new Error('Task title is required');
  assertEnum(route, TASK_ROUTES, 'task route');
  const p = ensureProject(root, projectSlug);
  fs.mkdirSync(p.tasks, { recursive: true });

  const id = ulid();
  const data = {
    id,
    title,
    created: new Date().toISOString(),
    stage,
    route,
    status: 'todo',
    surface,
    report: null,
    resume: Boolean(resume),
    project: projectSlug,
  };
  const file = path.join(p.tasks, `${id}.md`);
  writeDoc(file, data, body || `${title}\n`);
  return { ...data, path: file };
}

export function listTasks(root, { project, route, status } = {}) {
  const slugs = project ? [project] : listProjects(root).map((p) => p.slug);
  const out = [];
  for (const slug of slugs) {
    const dir = projectPaths(root, slug).tasks;
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const { data } = readDoc(path.join(dir, f));
      if (route && data.route !== route) continue;
      if (status && data.status !== status) continue;
      out.push({
        id: data.id ?? f.replace(/\.md$/, ''),
        project: data.project ?? slug,
        title: data.title ?? f,
        route: data.route ?? null,
        status: data.status ?? null,
        surface: data.surface ?? null,
        report: data.report ?? null,
        resume: data.resume ?? false,
        created: data.created ?? null,
      });
    }
  }
  return out.sort((a, b) => String(a.created).localeCompare(String(b.created)));
}

// "Where we left off" reminders: open tasks flagged resume:true, surfaced when
// Verqury opens. Active project first so the thing you're on greets you at the top.
const RESUME_CLOSED = new Set(['done', 'dropped']);
export function listResumeReminders(root) {
  const active = getActiveProject(root);
  return listTasks(root)
    .filter((t) => t.resume && !RESUME_CLOSED.has(t.status))
    .sort((a, b) => {
      const ap = a.project === active ? 0 : 1;
      const bp = b.project === active ? 0 : 1;
      return ap - bp || String(a.created).localeCompare(String(b.created));
    });
}

export function showTask(root, projectSlug, id) {
  const file = taskFile(root, projectSlug, id);
  if (!file) throw new Error(`No such task: ${projectSlug}/${id}`);
  const { data, body } = readDoc(file);
  return { ...data, id: data.id ?? id, project: data.project ?? projectSlug, body, path: file };
}

export function updateTask(root, projectSlug, id, patch = {}) {
  const file = taskFile(root, projectSlug, id);
  if (!file) throw new Error(`No such task: ${projectSlug}/${id}`);
  if (patch.route) assertEnum(patch.route, TASK_ROUTES, 'task route');
  if (patch.status) assertEnum(patch.status, TASK_STATUSES, 'task status');
  const { data, body } = readDoc(file);
  const { body: patchBody, ...fmPatch } = patch;
  const next = { ...data, ...fmPatch };
  writeDoc(file, next, patchBody != null ? patchBody : body);
  return { ...next };
}

export function deleteTask(root, projectSlug, id) {
  const file = taskFile(root, projectSlug, id);
  if (!file) throw new Error(`No such task: ${projectSlug}/${id}`);
  fs.rmSync(file);
  return { id, project: projectSlug };
}

// Build the hand-off payload: the surface's packet (project context), if any,
// followed by the task's own title + payload body.
export function renderHandoff(root, projectSlug, id) {
  const task = showTask(root, projectSlug, id);
  let context = '';
  if (task.surface) {
    const packet = listPackets(root).find((p) => p.surface === task.surface);
    if (packet) context = `${renderPacket(root, packet.slug, projectSlug).text}\n\n---\n\n`;
  }
  const payload = `${context}## Task: ${task.title}\n\n${task.body.trim()}\n`;
  return { payload, task: task.id, surface: task.surface ?? null };
}

// Close a task with a captured report: link the artifact, mark done, and echo a
// completion entry into project memory (the loop closes back into the timeline).
export function attachReport(root, projectSlug, id, artifactId) {
  const file = taskFile(root, projectSlug, id);
  if (!file) throw new Error(`No such task: ${projectSlug}/${id}`);
  const { data, body } = readDoc(file);
  data.report = artifactId;
  data.status = 'done';
  writeDoc(file, data, body);
  addLog(root, projectSlug, {
    text: `Task "${data.title}" completed. Report: artifact ${artifactId}.`,
    title: `Task done: ${data.title}`,
  });
  return { ...data };
}
