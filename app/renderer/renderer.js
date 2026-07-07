// Renderer: vanilla JS over the preload `window.verqury` bridge (ADR-0005).
// Two modes — Projects and Guidance. Read-only views plus the bounded mutations
// this stage allows: change a project's stage, create guidance, promote guidance.
// No free-form body editing — that would drift toward an IDE (anti-goal).
import { renderMarkdown } from '../src/markdown.js';

const el = (sel) => document.querySelector(sel);
const listEl = el('#list');
const detailEl = el('#detail');
const searchEl = el('#search');
const toastEl = el('#toast');

const state = {
  mode: 'projects',
  stages: [],
  kinds: [],
  artifactKinds: [],
  projects: [],
  guidance: [],
  artifacts: [],
  activeProject: null, // selected project in the projects view
  activeGuidance: null, // { scope, slug }
  activeArtifact: null, // { project, id }
  captureTarget: null, // project new captures file into (plan §4.3)
  inboxKind: '', // inbox kind filter
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

/* ---------- sidebar lists ---------- */

function renderProjectList() {
  listEl.replaceChildren(h('div', { class: 'section-label', text: 'Projects' }));
  if (!state.projects.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No projects yet.' }));
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

  const narrative = h('div', { class: 'markdown' });
  markdownInto(narrative, project.body ?? '');

  const timelineEl = h('div', { class: 'timeline' }, h('h2', { text: 'Memory timeline' }));
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

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: project.name }), select),
    sub, narrative, timelineEl,
  );
}

function renderGuidanceDetail(g) {
  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn', onclick: () => { window.verqury.copyToClipboard(g.body ?? ''); toast('Copied to clipboard'); } }, 'Copy'));
  if (g.scope !== 'global') {
    actions.append(h('button', { class: 'btn primary', onclick: () => onPromote(g.scope, g.slug) }, 'Promote to global'));
  }

  const meta = h('div', { class: 'detail-sub' },
    h('span', { class: 'badge kind', text: g.kind ?? '—' }),
    document.createTextNode(`  ${g.scope === 'global' ? 'global' : `project · ${g.scope}`}`));
  for (const t of g.tags ?? []) meta.append(h('span', { class: 'badge', text: t }));

  const body = h('div', { class: 'markdown' });
  markdownInto(body, g.body ?? '');

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
  if (mode === 'projects') {
    renderProjectList();
    if (state.activeProject) selectProject(state.activeProject);
    else detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select a project.' }));
  } else if (mode === 'guidance') {
    renderGuidanceList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select guidance, or create new.' }));
  } else {
    renderInboxList();
    detailEl.replaceChildren(h('div', { class: 'empty', text: 'Select an artifact, or press Ctrl+Alt+C to capture.' }));
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
      return renderInboxList();
    }
    renderSearchResults(await window.verqury.search(q));
  }, 180);
});

async function refreshAll() {
  await refreshProjects();
  await refreshGuidance();
  await refreshInbox();
}

async function init() {
  state.stages = await window.verqury.getStages();
  state.kinds = await window.verqury.guidanceKinds();
  state.artifactKinds = await window.verqury.artifactKinds();
  state.projects = await window.verqury.listProjects();
  state.guidance = await window.verqury.listAllGuidance();
  state.artifacts = await window.verqury.listArtifacts({});
  state.captureTarget = (await window.verqury.getActiveProject()) || (state.projects[0]?.slug ?? null);
  renderProjectList();
  if (state.projects.length) await selectProject(state.projects[0].slug);
  window.verqury.onDataChanged(() => refreshAll());
  window.verqury.onArtifactCaptured((info) => {
    setMode('inbox');
    refreshInbox().then(() => info && selectArtifact(info.project, info.id));
  });
  window.__verquryReady = true; // signal for headless verification
}

init();
