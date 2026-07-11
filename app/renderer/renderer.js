// Renderer: vanilla JS over the preload `window.verqury` bridge (ADR-0005).
// Two modes — Projects and Guidance. Read-only views plus the bounded mutations
// this stage allows: change a project's stage, create guidance, promote guidance.
// No free-form body editing — that would drift toward an IDE (anti-goal).
import { renderMarkdown } from '../src/markdown.js';
import { mountTerminal } from './terminal.js';

const el = (sel) => document.querySelector(sel);
const listEl = el('#list');
const detailEl = el('#detail');
const resumeEl = el('#resume');
const searchEl = el('#search');
const toastEl = el('#toast');

const state = {
  mode: 'projects',
  stages: [],
  statuses: [],
  kinds: [],
  artifactKinds: [],
  taskRoutes: [],
  taskStatuses: [],
  projects: [],
  guidance: [],
  artifacts: [],
  tasks: [],
  adapters: [],
  activeProject: null, // selected project in the projects view
  activeAdapter: null, // selected adapter slug in settings
  activeGuidance: null, // { scope, slug }
  activeArtifact: null, // { project, id }
  activeTask: null, // { project, id }
  captureTarget: null, // project new captures file into (plan §4.3)
  inboxKind: '', // inbox kind filter
  resumeSnoozed: new Set(), // task ids dismissed this session (reappear next open)
};

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1500);
}

/* ---------- theme (dark by default) ---------- */
const themeBtn = document.getElementById('theme-toggle');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = theme === 'light' ? '☀' : '☾';
}
applyTheme(localStorage.getItem('verqury-theme') || 'dark');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('verqury-theme', next);
  applyTheme(next);
});

/* ---------- drag-and-drop capture ---------- */
// Drag highlighted text (from another window or from a Verqury tile) onto the
// app to capture it into the active project — no copy/paste needed.
let dragDepth = 0;
const isField = (node) => node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
document.addEventListener('dragover', (e) => {
  if (isField(e.target)) return; // let form fields handle their own drops
  const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
  if (types.includes('text/plain') || types.includes('text/uri-list')) e.preventDefault();
});
document.addEventListener('dragenter', () => {
  dragDepth += 1;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', () => {
  dragDepth -= 1;
  if (dragDepth <= 0) document.body.classList.remove('dragging');
});
document.addEventListener('drop', async (e) => {
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (isField(e.target)) return; // dropped into a form field — native insert
  const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
  if (!text || !text.trim()) return;
  e.preventDefault();
  const r = await window.verqury.captureText(text);
  if (r && r.ok) toast(`Captured → ${r.project}`);
  else toast(r && r.reason === 'no-project' ? 'Create a project first' : 'Nothing captured');
});

// Render markdown into a container and route external links through the shell.
function markdownInto(container, src) {
  container.innerHTML = renderMarkdown(src);
  for (const a of container.querySelectorAll('a[href]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.verqury.openExternal(a.getAttribute('href'));
    });
  }
}

// Rendered markdown with a click-to-edit affordance. `host` is a .editable div;
// getBody() returns the current text; onSave(text) persists it.
function editableMarkdown(host, getBody, onSave) {
  const showView = () => {
    const view = h('div', { class: 'markdown' });
    markdownInto(view, getBody() || '_Empty — click Edit to write._');
    host.replaceChildren(h('button', { class: 'btn small edit-btn', onclick: showEdit }, '✎ Edit'), view);
  };
  const showEdit = () => {
    const ta = h('textarea', { class: 'inline-editor', spellcheck: 'false' });
    ta.value = getBody() || '';
    const save = h('button', { class: 'btn primary', onclick: async () => { await onSave(ta.value); } }, 'Save');
    const cancel = h('button', { class: 'btn', onclick: showView }, 'Cancel');
    host.replaceChildren(ta, h('div', { class: 'detail-actions' }, save, cancel));
    ta.focus();
  };
  showView();
}

// Add a log entry or decision to a project (takes over the detail pane).
function showMemoryForm(slug, kind) {
  const titleInput = h('input', { type: 'text', placeholder: `${kind} title` });
  const bodyArea = h('textarea', { class: 'inline-editor', spellcheck: 'false', placeholder: kind === 'Decision' ? 'Context / Decision / Consequences' : 'What happened' });
  const create = h('button', { class: 'btn primary', onclick: async () => {
    try {
      if (kind === 'Decision') {
        if (!titleInput.value.trim()) return toast('Title is required');
        await window.verqury.addDecision(slug, { title: titleInput.value.trim(), body: bodyArea.value });
      } else {
        const text = bodyArea.value.trim() || titleInput.value.trim();
        if (!text) return toast('Add some text');
        await window.verqury.addLog(slug, { text, title: titleInput.value.trim() || null });
      }
      toast(`${kind} added`);
      selectProject(slug);
    } catch (err) { toast(err.message); }
  } }, 'Save');
  const cancel = h('button', { class: 'btn', onclick: () => selectProject(slug) }, 'Cancel');
  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: `New ${kind.toLowerCase()} · ${slug}` })),
    h('div', { class: 'form' },
      h('label', {}, 'Title', titleInput),
      h('label', {}, kind === 'Decision' ? 'Body' : 'Entry', bodyArea),
      h('div', { class: 'detail-actions' }, create, cancel)),
  );
}

/* ---------- sidebar lists ---------- */

function renderProjectList() {
  listEl.replaceChildren(h('button', { class: 'btn wide', onclick: showNewProjectForm }, '＋ New project'));
  listEl.append(h('div', { class: 'section-label', text: 'Projects' }));
  if (!state.projects.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No projects yet — create one above.' }));
    return;
  }
  for (const p of state.projects) {
    listEl.append(
      h('div', { class: `project-card${p.slug === state.activeProject ? ' active' : ''}`, onclick: () => selectProject(p.slug) },
        h('div', { class: 'name', text: p.name }),
        h('div', { class: 'card-meta' },
          h('span', { class: 'badge stage', text: p.stage ?? '—' }),
          h('span', { class: 'badge', text: p.status ?? '—' }))),
    );
  }
}

function renderGuidanceList() {
  listEl.replaceChildren(h('button', { class: 'btn wide', onclick: showNewGuidanceForm }, '＋ New guidance'));
  const scopes = [...new Set(state.guidance.map((g) => g.scope))].sort((a, b) =>
    a === 'global' ? -1 : b === 'global' ? 1 : a.localeCompare(b));
  if (!state.guidance.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No guidance yet.' }));
    return;
  }
  for (const scope of scopes) {
    listEl.append(h('div', { class: 'section-label', text: scope === 'global' ? 'Global' : scope }));
    for (const g of state.guidance.filter((x) => x.scope === scope)) {
      const active = state.activeGuidance && state.activeGuidance.scope === g.scope && state.activeGuidance.slug === g.slug;
      listEl.append(
        h('div', { class: `project-card${active ? ' active' : ''}`, onclick: () => selectGuidance(g.scope, g.slug) },
          h('div', { class: 'name', text: g.title }),
          h('div', { class: 'card-meta' }, h('span', { class: 'badge kind', text: g.kind ?? '—' }))),
      );
    }
  }
}

function renderSearchResults(hits) {
  listEl.replaceChildren(h('div', { class: 'section-label', text: `Results (${hits.length})` }));
  for (const hit of hits) {
    const where = hit.project ? `${hit.type} · ${hit.project}` : hit.type;
    listEl.append(
      h('div', { class: 'result-card', onclick: () => openHit(hit) },
        h('div', { class: 'name', text: hit.title }),
        h('div', { class: 'where', text: where })),
    );
  }
}

function openHit(hit) {
  const base = (hit.path || '').split('/').pop()?.replace(/\.md$/, '');
  if (hit.type === 'guidance') {
    setMode('guidance');
    selectGuidance(hit.project || 'global', base);
  } else if (hit.type === 'artifact') {
    setMode('inbox');
    selectArtifact(hit.project, base);
  } else if (hit.type === 'task') {
    setMode('tasks');
    selectTask(hit.project, base);
  } else if (hit.project) {
    setMode('projects');
    selectProject(hit.project);
  }
}

/* ---------- inbox ---------- */

function renderInboxList() {
  const targetSel = h('select', {
    onchange: async (e) => {
      state.captureTarget = e.target.value;
      await window.verqury.setActiveProject(e.target.value);
    },
  });
  for (const p of state.projects) {
    const opt = h('option', { value: p.slug, text: p.name });
    if (p.slug === state.captureTarget) opt.selected = true;
    targetSel.append(opt);
  }
  const kindFilter = h('select', { class: 'kind-filter', onchange: (e) => { state.inboxKind = e.target.value; renderInboxList(); } });
  kindFilter.append(h('option', { value: '', text: 'All kinds' }));
  for (const k of state.artifactKinds) {
    const o = h('option', { value: k, text: k });
    if (k === state.inboxKind) o.selected = true;
    kindFilter.append(o);
  }

  listEl.replaceChildren(
    h('div', { class: 'capture-controls' },
      h('div', { class: 'capture-row' }, h('span', { class: 'muted', text: 'Capture to' }), targetSel),
      h('button', { class: 'btn wide', onclick: () => window.verqury.captureNow() }, 'Capture clipboard  ⌃⌥C'),
      h('div', { class: 'capture-row' }, h('span', { class: 'muted', text: 'Filter' }), kindFilter)),
  );

  const items = state.artifacts.filter((a) => !state.inboxKind || a.kind === state.inboxKind);
  if (!items.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No artifacts. Copy something and press Ctrl+Alt+C.' }));
    return;
  }
  for (const a of items) {
    const active = state.activeArtifact && state.activeArtifact.id === a.id;
    listEl.append(
      h('div', { class: `artifact-card${active ? ' active' : ''}`, onclick: () => selectArtifact(a.project, a.id) },
        h('div', { class: 'card-meta' },
          h('span', { class: 'badge kind', text: a.kind ?? '—' }),
          h('span', { class: 'badge', text: a.project })),
        h('div', { class: 'preview', text: a.preview || '(empty)' }),
        h('div', { class: 'when', text: (a.captured ?? '').replace('T', ' ').slice(0, 16) })),
    );
  }
}

function renderArtifactDetail(a) {
  const kindSel = h('select', {
    onchange: async (e) => { await window.verqury.setArtifactKind(a.project, a.id, e.target.value); toast('Kind updated'); await refreshInbox(); },
  });
  for (const k of state.artifactKinds) {
    const o = h('option', { value: k, text: k });
    if (k === a.kind) o.selected = true;
    kindSel.append(o);
  }

  const tagsInput = h('input', { type: 'text', value: (a.tags ?? []).join(', '), placeholder: 'comma, separated, tags' });
  const saveTags = h('button', { class: 'btn', onclick: async () => {
    const tags = tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    await window.verqury.retagArtifact(a.project, a.id, tags);
    toast('Tags saved');
    await refreshInbox();
  } }, 'Save');

  const body = h('pre', { class: 'artifact-body' });
  body.textContent = a.body ?? '';

  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn primary', onclick: () => { window.verqury.copyToClipboard(a.body ?? ''); toast('Copied to clipboard'); } }, 'Copy back'),
    h('button', { class: 'btn', onclick: async () => {
      await window.verqury.deleteArtifact(a.project, a.id);
      state.activeArtifact = null;
      toast('Deleted');
      await refreshInbox();
      detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select an artifact.' }));
    } }, 'Delete'));

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: a.title || a.kind || 'Artifact' })),
    h('div', { class: 'detail-sub', text: `captured ${(a.captured ?? '').replace('T', ' ').slice(0, 19)} · ${a.project} · ${a.source ?? ''}` }),
    h('div', { class: 'form-row' },
      h('label', {}, 'Kind', kindSel),
      h('label', {}, 'Tags', h('div', { class: 'tag-edit' }, tagsInput, saveTags))),
    actions, body,
  );
}

async function selectArtifact(project, id) {
  state.activeArtifact = { project, id };
  renderInboxList();
  try {
    renderArtifactDetail(await window.verqury.getArtifact(project, id));
  } catch {
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Artifact not found.' }));
  }
}

async function refreshInbox() {
  state.artifacts = await window.verqury.listArtifacts({});
  if (searchEl.value.trim()) return;
  if (state.mode === 'inbox') renderInboxList();
}

/* ---------- resume reminders ("where we left off") ---------- */

// The strip across the top of the window: open tasks flagged resume:true, shown
// when Verqury opens. Dismiss (snooze) hides for this session; Done closes it.
async function renderResumeStrip() {
  const reminders = (await window.verqury.resumeReminders())
    .filter((t) => !state.resumeSnoozed.has(t.id));
  if (!reminders.length) {
    resumeEl.hidden = true;
    resumeEl.replaceChildren();
    return;
  }
  const cards = reminders.map((t) => {
    const adapter = t.resumeAdapter ? state.adapters.find((a) => a.slug === t.resumeAdapter) : null;
    const resumeBtn = t.resumeAdapter
      ? h('button', {
          class: 'btn small primary',
          title: `Relaunch ${adapter ? adapter.label : t.resumeAdapter} at ${t.project} and jump back in`,
          onclick: async () => { await window.verqury.launchAdapter(t.resumeAdapter, t.project); toast(`Launching ${adapter ? adapter.label : t.resumeAdapter}…`); },
        }, `▶ Resume in ${adapter ? adapter.label : t.resumeAdapter}`)
      : null;
    return h('div', { class: 'resume-card' },
      h('span', { class: 'resume-text' },
        h('span', { class: 'resume-proj', text: t.project }),
        h('span', { text: t.title })),
      h('span', { class: 'resume-actions' },
        resumeBtn,
        h('button', { class: 'btn small', title: 'Open this task', onclick: () => { setMode('tasks'); selectTask(t.project, t.id); } }, 'Open'),
        h('button', { class: 'btn small', title: 'Hide until next time you open Verqury', onclick: async () => { state.resumeSnoozed.add(t.id); await renderResumeStrip(); } }, 'Snooze'),
        h('button', { class: 'btn small', title: 'Mark done — clears the reminder', onclick: async () => { await window.verqury.updateTask(t.project, t.id, { status: 'done' }); toast('Reminder done'); await refreshTasks(); await renderResumeStrip(); } }, 'Done')));
  });
  resumeEl.replaceChildren(
    h('span', { class: 'resume-label', text: '⏸ Where you left off' }),
    ...cards,
  );
  resumeEl.hidden = false;
}

/* ---------- tasks ---------- */

function renderTaskList() {
  listEl.replaceChildren(h('button', { class: 'btn wide', onclick: showNewTaskForm }, '＋ New task'));
  if (!state.tasks.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No tasks yet.' }));
    return;
  }
  for (const route of state.taskRoutes) {
    const lane = state.tasks.filter((t) => t.route === route);
    if (!lane.length) continue;
    listEl.append(h('div', { class: 'section-label', text: route }));
    for (const t of lane) {
      const active = state.activeTask && state.activeTask.id === t.id;
      listEl.append(
        h('div', { class: `task-card${active ? ' active' : ''}`, onclick: () => selectTask(t.project, t.id) },
          h('div', { class: 'name', text: t.title }),
          h('div', { class: 'card-meta' },
            h('span', { class: `badge status-${t.status}`, text: t.status }),
            h('span', { class: 'badge', text: t.project }))),
      );
    }
  }
}

function renderTaskDetail(t, artifacts) {
  const statusSel = h('select', { onchange: async (e) => { await window.verqury.updateTask(t.project, t.id, { status: e.target.value }); toast('Status updated'); await refreshTasks(); } });
  for (const s of state.taskStatuses) {
    const o = h('option', { value: s, text: s });
    if (s === t.status) o.selected = true;
    statusSel.append(o);
  }
  const routeSel = h('select', { onchange: async (e) => { await window.verqury.updateTask(t.project, t.id, { route: e.target.value }); toast('Route updated'); await refreshTasks(); } });
  for (const r of state.taskRoutes) {
    const o = h('option', { value: r, text: r });
    if (r === t.route) o.selected = true;
    routeSel.append(o);
  }

  const resumeToggle = h('input', { type: 'checkbox', onchange: async (e) => {
    await window.verqury.updateTask(t.project, t.id, { resume: e.target.checked });
    toast(e.target.checked ? 'Will greet you when Verqury opens' : 'Reminder off');
    await refreshTasks();
    await renderResumeStrip();
  } });
  if (t.resume) resumeToggle.checked = true;

  // Which code tool to relaunch from the resume strip ("jump back in").
  const resumeAdapterSel = h('select', { onchange: async (e) => {
    await window.verqury.updateTask(t.project, t.id, { resumeAdapter: e.target.value || null });
    toast(e.target.value ? 'Resume tool set' : 'Resume tool cleared');
    await refreshTasks();
    await renderResumeStrip();
  } });
  resumeAdapterSel.append(h('option', { value: '', text: '— no launch tool —' }));
  for (const a of state.adapters) {
    const o = h('option', { value: a.slug, text: a.label });
    if (a.slug === t.resumeAdapter) o.selected = true;
    resumeAdapterSel.append(o);
  }

  const body = h('pre', { class: 'artifact-body' });
  body.textContent = t.body ?? '';

  const handoff = h('button', { class: 'btn primary', onclick: async () => {
    await window.verqury.handoffTask(t.project, t.id);
    toast('Payload copied — handed off');
    await refreshTasks();
    selectTask(t.project, t.id);
  } }, 'Hand off (copy payload)');

  // Attach-report: pick one of the project's artifacts as the completion report.
  const reportSel = h('select', {});
  reportSel.append(h('option', { value: '', text: artifacts.length ? 'Pick a report artifact…' : 'No artifacts captured yet' }));
  for (const a of artifacts) reportSel.append(h('option', { value: a.id, text: `${a.kind} · ${(a.preview || a.id).slice(0, 40)}` }));
  const attach = h('button', { class: 'btn', onclick: async () => {
    if (!reportSel.value) return toast('Pick an artifact first');
    await window.verqury.attachReport(t.project, t.id, reportSel.value);
    toast('Report attached — task done');
    await refreshTasks();
    selectTask(t.project, t.id);
  } }, 'Attach report');

  const del = h('button', { class: 'btn', onclick: async () => {
    await window.verqury.deleteTask(t.project, t.id);
    state.activeTask = null;
    toast('Task deleted');
    await refreshTasks();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select a task.' }));
  } }, 'Delete');

  const reportLine = t.report
    ? h('div', { class: 'detail-sub', text: `report: artifact ${t.report}` })
    : null;

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: t.title })),
    h('div', { class: 'detail-sub', text: `${t.project} · created ${(t.created ?? '').replace('T', ' ').slice(0, 16)}${t.surface ? ` · surface ${t.surface}` : ''}` }),
    reportLine,
    h('div', { class: 'form-row' }, h('label', {}, 'Status', statusSel), h('label', {}, 'Route', routeSel)),
    h('div', { class: 'resume-row' },
      h('label', { class: 'resume-check' }, resumeToggle, h('span', { text: 'Remind me on open (surface this when Verqury opens)' })),
      h('label', { class: 'resume-tool' }, h('span', { text: 'Resume in' }), resumeAdapterSel)),
    h('div', { class: 'detail-actions' }, handoff, del),
    h('div', { class: 'form-row' }, h('label', {}, 'Report', h('div', { class: 'tag-edit' }, reportSel, attach))),
    h('h2', { class: 'section-label', text: 'Payload' }),
    body,
  );
}

async function showNewTaskForm() {
  state.activeTask = null;
  const packets = await window.verqury.listPackets();
  const surfaces = [...new Set(packets.map((p) => p.surface).filter(Boolean))];

  const titleInput = h('input', { type: 'text', placeholder: 'Task title' });
  const projectSel = h('select', {});
  for (const p of state.projects) projectSel.append(h('option', { value: p.slug, text: p.name }));
  const routeSel = h('select', {});
  for (const r of state.taskRoutes) routeSel.append(h('option', { value: r, text: r }));
  const surfaceSel = h('select', {});
  surfaceSel.append(h('option', { value: '', text: '(no surface)' }));
  for (const s of surfaces) surfaceSel.append(h('option', { value: s, text: s }));
  const bodyArea = h('textarea', { spellcheck: 'false', placeholder: 'Description / hand-off payload' });

  const create = h('button', { class: 'btn primary', onclick: async () => {
    if (!titleInput.value.trim()) return toast('Title is required');
    if (!projectSel.value) return toast('Create a project first');
    const t = await window.verqury.addTask(projectSel.value, {
      title: titleInput.value.trim(), route: routeSel.value, surface: surfaceSel.value || null, body: bodyArea.value,
    });
    await refreshTasks();
    selectTask(t.project, t.id);
    toast('Task created');
  } }, 'Create');
  const cancel = h('button', { class: 'btn', onclick: () => renderTaskList() }, 'Cancel');

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: 'New task' })),
    h('div', { class: 'form' },
      h('label', {}, 'Title', titleInput),
      h('div', { class: 'form-row' }, h('label', {}, 'Project', projectSel), h('label', {}, 'Route', routeSel), h('label', {}, 'Surface', surfaceSel)),
      h('label', {}, 'Payload', bodyArea),
      h('div', { class: 'detail-actions' }, create, cancel)),
  );
}

async function selectTask(project, id) {
  state.activeTask = { project, id };
  renderTaskList();
  try {
    const [task, artifacts] = await Promise.all([
      window.verqury.getTask(project, id),
      window.verqury.listArtifacts({ project }),
    ]);
    renderTaskDetail(task, artifacts);
  } catch {
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Task not found.' }));
  }
}

async function refreshTasks() {
  state.tasks = await window.verqury.listTasks({});
  if (searchEl.value.trim()) return;
  if (state.mode === 'tasks') renderTaskList();
}

/* ---------- detail panes ---------- */

function renderProjectDetail(project, timeline) {
  const select = h('select', { class: 'stage-select', onchange: (e) => onStageChange(e.target.value) });
  for (const s of state.stages) {
    const opt = h('option', { value: s, text: s });
    if (s === project.stage) opt.selected = true;
    select.append(opt);
  }

  const sub = h('div', { class: 'detail-sub' },
    document.createTextNode(`status: ${project.status ?? '—'} · created ${project.created ?? '—'}`));
  if (project.repo) sub.append(document.createTextNode(` · repo: ${project.repo}`));
  for (const link of project.links ?? []) {
    sub.append(document.createTextNode(' · '));
    sub.append(h('a', { href: link.url, onclick: (e) => { e.preventDefault(); window.verqury.openExternal(link.url); }, text: link.label }));
  }

  const narrative = h('div', { class: 'editable' });
  editableMarkdown(
    narrative,
    () => project.body ?? '',
    async (val) => { await window.verqury.setNarrative(project.slug, val); toast('Narrative saved'); selectProject(project.slug); },
  );

  const timelineEl = h('div', { class: 'timeline' },
    h('div', { class: 'timeline-head' },
      h('h2', { text: 'Memory timeline' }),
      h('button', { class: 'btn small', onclick: () => showMemoryForm(project.slug, 'Log') }, '＋ Log'),
      h('button', { class: 'btn small', onclick: () => showMemoryForm(project.slug, 'Decision') }, '＋ Decision')));
  if (!timeline.length) timelineEl.append(h('div', { class: 'detail-sub', text: 'No log entries or decisions yet.' }));
  for (const entry of timeline) {
    const kind = entry.type === 'decision' ? `decision #${entry.number}` : 'log';
    const preview = (entry.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    timelineEl.append(
      h('div', { class: 'timeline-entry' },
        h('div', { class: 'when', text: entry.date ?? '' }),
        h('div', { class: 'what' },
          h('div', {}, h('span', { class: 'kind', text: kind }), document.createTextNode(entry.title ?? '')),
          preview ? h('div', { class: 'body', text: preview }) : null)),
    );
  }

  const launchRow = h('div', { class: 'launch-row' });
  if (state.adapters.length) {
    launchRow.append(h('span', { class: 'muted', text: 'Launch:' }));
    for (const a of state.adapters) {
      launchRow.append(h('button', { class: 'btn', title: a.notes ?? '', onclick: async () => {
        try {
          const r = await window.verqury.launchAdapter(a.slug, project.slug);
          toast(r.copiedPacket ? `Launched ${a.label} — context copied` : `Launched ${a.label}`);
        } catch (err) { toast(err.message); }
      } }, a.label));
    }
  }

  const bootstrapBtn = h('button', { class: 'btn', onclick: () => showBootstrap(project.slug) }, '⚡ Bootstrap');
  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: project.name }), h('div', { class: 'head-actions' }, bootstrapBtn, select)),
    sub, launchRow, narrative, timelineEl,
  );
}

/* ---------- settings: adapter registry ---------- */

function renderSettingsList() {
  listEl.replaceChildren(h('button', { class: 'btn wide', onclick: () => showAdapterForm(null) }, '＋ New adapter'));
  listEl.append(h('div', { class: 'section-label', text: 'AI surfaces' }));
  for (const a of state.adapters) {
    const active = state.activeAdapter === a.slug;
    listEl.append(
      h('div', { class: `adapter-card${active ? ' active' : ''}`, onclick: () => showAdapterForm(a.slug) },
        h('div', { class: 'name', text: a.label }),
        h('div', { class: 'card-meta' },
          h('span', { class: 'badge', text: a.slug }),
          a.packet ? h('span', { class: 'badge kind', text: a.packet }) : null)),
    );
  }
}

async function showAdapterForm(slug) {
  state.activeAdapter = slug;
  renderSettingsList();
  const existing = slug ? state.adapters.find((a) => a.slug === slug) : null;
  const packets = await window.verqury.listPackets();

  const labelInput = h('input', { type: 'text', placeholder: 'Label' });
  labelInput.value = existing?.label ?? '';
  const commandInput = h('input', { type: 'text', placeholder: 'e.g. xfce4-terminal --working-directory={{repo}} --command=claude' });
  commandInput.value = existing?.command ?? '';
  const packetSel = h('select', {});
  packetSel.append(h('option', { value: '', text: '(no handoff packet)' }));
  for (const p of packets) {
    const o = h('option', { value: p.slug, text: p.title });
    if (existing?.packet === p.slug) o.selected = true;
    packetSel.append(o);
  }
  const targetSel = h('select', {});
  for (const [val, txt] of [['terminal', 'Embedded terminal (in-app)'], ['external', 'External (spawn detached)']]) {
    const o = h('option', { value: val, text: txt });
    if ((existing?.target ?? 'external') === val) o.selected = true;
    targetSel.append(o);
  }
  const notesInput = h('textarea', { placeholder: 'Notes' });
  notesInput.value = existing?.notes ?? '';

  const save = h('button', { class: 'btn primary', onclick: async () => {
    if (!labelInput.value.trim()) return toast('Label is required');
    const payload = { label: labelInput.value.trim(), command: commandInput.value, packet: packetSel.value || null, notes: notesInput.value, target: targetSel.value };
    try {
      if (existing) await window.verqury.updateAdapter(existing.slug, payload);
      else state.activeAdapter = (await window.verqury.addAdapter(payload)).slug;
      await refreshAdapters();
      toast('Saved');
      showAdapterForm(state.activeAdapter);
    } catch (err) { toast(err.message); }
  } }, 'Save');

  const buttons = [save];
  if (existing) {
    buttons.push(h('button', { class: 'btn', onclick: async () => {
      await window.verqury.removeAdapter(existing.slug);
      state.activeAdapter = null;
      await refreshAdapters();
      toast('Removed');
      detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select or add an adapter.' }));
    } }, 'Delete'));
  }

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: existing ? existing.label : 'New adapter' })),
    h('div', { class: 'detail-sub', text: 'An AI surface defined purely by config — a launch command plus a handoff packet. Adding one needs no code (ADR-0004). Use {{repo}} and {{project.name}} in the command.' }),
    h('div', { class: 'form' },
      h('label', {}, 'Label', labelInput),
      h('div', { class: 'form-row' }, h('label', {}, 'Launch command', commandInput), h('label', {}, 'Run in', targetSel)),
      h('label', {}, 'Handoff packet', packetSel),
      h('label', {}, 'Notes', notesInput),
      h('div', { class: 'detail-actions' }, ...buttons)),
  );
}

async function refreshAdapters() {
  state.adapters = await window.verqury.listAdapters();
  if (state.mode === 'settings') renderSettingsList();
}

function showNewProjectForm() {
  state.activeProject = null;
  renderProjectList();
  const nameInput = h('input', { type: 'text', placeholder: 'Project name' });
  const stageSel = h('select', {});
  for (const s of state.stages) stageSel.append(h('option', { value: s, text: s }));
  const statusSel = h('select', {});
  for (const s of state.statuses) statusSel.append(h('option', { value: s, text: s }));
  const repoInput = h('input', { type: 'text', placeholder: 'Repo path (optional) — e.g. /home/you/code/project' });
  const bodyArea = h('textarea', { spellcheck: 'false', placeholder: 'Narrative — the concept and where it stands (optional)' });

  const create = h('button', { class: 'btn primary', onclick: async () => {
    if (!nameInput.value.trim()) return toast('Name is required');
    try {
      const p = await window.verqury.createProject({
        name: nameInput.value.trim(),
        stage: stageSel.value,
        status: statusSel.value,
        repo: repoInput.value.trim() || null,
        body: bodyArea.value,
      });
      await refreshProjects();
      selectProject(p.slug);
      toast('Project created');
    } catch (err) { toast(err.message); }
  } }, 'Create');
  const cancel = h('button', { class: 'btn', onclick: () => { renderProjectList(); detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select a project.' })); } }, 'Cancel');

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: 'New project' })),
    h('div', { class: 'form' },
      h('label', {}, 'Name', nameInput),
      h('div', { class: 'form-row' }, h('label', {}, 'Stage', stageSel), h('label', {}, 'Status', statusSel)),
      h('label', {}, 'Repo path', repoInput),
      h('label', {}, 'Narrative', bodyArea),
      h('div', { class: 'detail-actions' }, create, cancel)),
  );
}

// Session bootstrapper: pick a packet, preview it rendered for this project,
// then copy to clipboard or write to the packet's output file.
async function showBootstrap(projectSlug) {
  const { project } = await window.verqury.getProject(projectSlug);
  const list = await window.verqury.listPackets();
  const sel = h('select', { onchange: () => renderPreview() });
  for (const p of list) sel.append(h('option', { value: p.slug, text: `${p.title} · ${p.surface ?? '—'}` }));

  const preview = h('pre', { class: 'artifact-body' });
  const actions = h('div', { class: 'detail-actions' });

  async function renderPreview() {
    if (!sel.value) return;
    const r = await window.verqury.renderPacket(sel.value, projectSlug, {});
    preview.textContent = r.text;
    const buttons = [
      h('button', { class: 'btn primary', onclick: () => { window.verqury.copyToClipboard(r.text); toast('Copied to clipboard'); } }, 'Copy to clipboard'),
      h('button', { class: 'btn', onclick: () => { window.verqury.ptySend(r.text); toast('Sent to terminal'); } }, '→ Terminal'),
    ];
    if (r.output) {
      buttons.push(h('button', { class: 'btn', onclick: async () => {
        try { await window.verqury.writePacket(r.output, r.text); toast(`Wrote ${r.output}`); }
        catch (err) { toast(err.message); }
      } }, `Write ${r.output}`));
    }
    buttons.push(h('button', { class: 'btn', onclick: () => selectProject(projectSlug) }, 'Back'));
    actions.replaceChildren(...buttons);
  }

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: `Bootstrap · ${project.name}` }), h('div', { class: 'head-actions' }, sel)),
    h('div', { class: 'detail-sub', text: 'Assemble a context packet for a work surface, then copy it or write it to the project repo.' }),
    actions, preview,
  );
  await renderPreview();
}

function renderGuidanceDetail(g) {
  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn', onclick: () => { window.verqury.copyToClipboard(g.body ?? ''); toast('Copied to clipboard'); } }, 'Copy'),
    h('button', { class: 'btn', onclick: () => { window.verqury.ptySend(g.body ?? ''); toast('Sent to terminal'); } }, '→ Terminal'));
  if (g.scope !== 'global') {
    actions.append(h('button', { class: 'btn primary', onclick: () => onPromote(g.scope, g.slug) }, 'Promote to global'));
  }

  const meta = h('div', { class: 'detail-sub' },
    h('span', { class: 'badge kind', text: g.kind ?? '—' }),
    document.createTextNode(`  ${g.scope === 'global' ? 'global' : `project · ${g.scope}`}`));
  for (const t of g.tags ?? []) meta.append(h('span', { class: 'badge', text: t }));

  const body = h('div', { class: 'editable' });
  editableMarkdown(
    body,
    () => g.body ?? '',
    async (val) => { await window.verqury.setGuidanceBody(g.scope, g.slug, val); toast('Saved'); selectGuidance(g.scope, g.slug); },
  );

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: g.title })),
    meta, actions, body,
  );
}

function scaffold(kind, title) {
  const t = title || 'Untitled';
  if (kind === 'skill') return `# ${t}\n\n## When to use\n\n## How it works\n`;
  if (kind === 'standard') return `# ${t}\n\n## Rule\n\n## Rationale\n`;
  if (kind === 'instruction') return `# ${t}\n\n- \n`;
  return `# ${t}\n`;
}

function showNewGuidanceForm() {
  state.activeGuidance = null;
  const titleInput = h('input', { type: 'text', placeholder: 'Guidance title', oninput: syncScaffold });
  const kindSelect = h('select', { onchange: syncScaffold });
  for (const k of state.kinds) kindSelect.append(h('option', { value: k, text: k }));
  const scopeSelect = h('select', {});
  scopeSelect.append(h('option', { value: 'global', text: 'Global' }));
  for (const p of state.projects) scopeSelect.append(h('option', { value: p.slug, text: `Project · ${p.name}` }));
  const bodyArea = h('textarea', { spellcheck: 'false' });
  bodyArea.value = scaffold(state.kinds[0], '');
  let bodyTouched = false;
  bodyArea.addEventListener('input', () => (bodyTouched = true));
  function syncScaffold() {
    if (!bodyTouched) bodyArea.value = scaffold(kindSelect.value, titleInput.value);
  }

  const create = h('button', { class: 'btn primary', onclick: async () => {
    if (!titleInput.value.trim()) return toast('Title is required');
    try {
      const g = await window.verqury.createGuidance({
        scope: scopeSelect.value, title: titleInput.value.trim(), kind: kindSelect.value, body: bodyArea.value,
      });
      await refreshGuidance();
      selectGuidance(g.scope, g.slug);
      toast('Guidance created');
    } catch (err) { toast(err.message); }
  } }, 'Create');
  const cancel = h('button', { class: 'btn', onclick: () => (state.projects.length || state.guidance.length ? renderActive() : detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select guidance.' }))) }, 'Cancel');

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: 'New guidance' })),
    h('div', { class: 'form' },
      h('label', {}, 'Title', titleInput),
      h('div', { class: 'form-row' }, h('label', {}, 'Kind', kindSelect), h('label', {}, 'Scope', scopeSelect)),
      h('label', {}, 'Body', bodyArea),
      h('div', { class: 'detail-actions' }, create, cancel)),
  );
}

/* ---------- actions ---------- */

async function selectProject(slug) {
  state.activeProject = slug;
  renderProjectList();
  const { project, timeline } = await window.verqury.getProject(slug);
  renderProjectDetail(project, timeline);
}

async function selectGuidance(scope, slug) {
  state.activeGuidance = { scope, slug };
  renderGuidanceList();
  try {
    renderGuidanceDetail(await window.verqury.getGuidance(scope, slug));
  } catch {
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Guidance not found.' }));
  }
}

async function onStageChange(stage) {
  if (!state.activeProject) return;
  await window.verqury.setStage(state.activeProject, stage);
  toast(`Stage → ${stage}`);
  await refreshProjects();
}

async function onPromote(scope, slug) {
  try {
    const g = await window.verqury.promoteGuidance(scope, slug);
    await refreshGuidance();
    selectGuidance('global', g.slug);
    toast('Promoted to global');
  } catch (err) { toast(err.message); }
}

/* ---------- refresh / mode ---------- */

async function refreshProjects() {
  state.projects = await window.verqury.listProjects();
  if (searchEl.value.trim()) return;
  if (state.mode === 'projects') {
    renderProjectList();
    if (state.activeProject) {
      const { project, timeline } = await window.verqury.getProject(state.activeProject);
      renderProjectDetail(project, timeline);
    }
  }
}

async function refreshGuidance() {
  state.guidance = await window.verqury.listAllGuidance();
  if (searchEl.value.trim()) return;
  if (state.mode === 'guidance') renderGuidanceList();
}

function renderActive() {
  if (state.mode === 'projects') {
    renderProjectList();
    if (state.activeProject) selectProject(state.activeProject);
  } else {
    renderGuidanceList();
    if (state.activeGuidance) selectGuidance(state.activeGuidance.scope, state.activeGuidance.slug);
  }
}

function setMode(mode) {
  state.mode = mode;
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.mode === mode);
  searchEl.value = '';
  detailEl.className = 'detail'; // reset any mode-specific layout (e.g. terminal)
  if (mode === 'projects') {
    renderProjectList();
    if (state.activeProject) selectProject(state.activeProject);
    else detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select a project.' }));
  } else if (mode === 'guidance') {
    renderGuidanceList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select guidance, or create new.' }));
  } else if (mode === 'inbox') {
    renderInboxList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select an artifact, or press Ctrl+Alt+C to capture.' }));
  } else if (mode === 'tasks') {
    renderTaskList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select a task, or create a new one.' }));
  } else if (mode === 'terminal') {
    listEl.replaceChildren(
      h('div', { class: 'section-label', text: 'Terminal' }),
      h('div', { class: 'project-card', text: 'Your shell, running inside Verqury. Type as normal, or drag text onto it.' }),
    );
    detailEl.className = 'detail terminal-mode';
    mountTerminal(detailEl);
  } else {
    renderSettingsList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select or add an adapter (an AI surface).' }));
  }
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => setMode(tab.dataset.mode));

let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  searchTimer = setTimeout(async () => {
    if (!q) {
      if (state.mode === 'projects') return renderProjectList();
      if (state.mode === 'guidance') return renderGuidanceList();
      if (state.mode === 'inbox') return renderInboxList();
      if (state.mode === 'tasks') return renderTaskList();
      if (state.mode === 'terminal') return;
      return renderSettingsList();
    }
    renderSearchResults(await window.verqury.search(q));
  }, 180);
});

async function refreshAll() {
  await refreshProjects();
  await refreshGuidance();
  await refreshInbox();
  await refreshTasks();
  await refreshAdapters();
}

async function init() {
  state.stages = await window.verqury.getStages();
  state.statuses = await window.verqury.getStatuses();
  state.kinds = await window.verqury.guidanceKinds();
  state.artifactKinds = await window.verqury.artifactKinds();
  state.taskRoutes = await window.verqury.taskRoutes();
  state.taskStatuses = await window.verqury.taskStatuses();
  state.projects = await window.verqury.listProjects();
  state.guidance = await window.verqury.listAllGuidance();
  state.artifacts = await window.verqury.listArtifacts({});
  state.tasks = await window.verqury.listTasks({});
  state.adapters = await window.verqury.listAdapters();
  state.captureTarget = (await window.verqury.getActiveProject()) || (state.projects[0]?.slug ?? null);
  renderProjectList();
  if (state.projects.length) await selectProject(state.projects[0].slug);
  window.verqury.onDataChanged(() => refreshAll());
  window.verqury.onArtifactCaptured((info) => {
    setMode('inbox');
    refreshInbox().then(() => info && selectArtifact(info.project, info.id));
  });
  window.verqury.onNavTerminal(() => setMode('terminal'));
  await renderResumeStrip(); // greet with pending reminders on first open
  window.verqury.onAppShown(() => renderResumeStrip()); // and each foregrounding
  window.__verquryReady = true; // signal for headless verification
}

init();
