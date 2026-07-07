// Renderer: vanilla JS over the preload `window.verqury` bridge (ADR-0005).
// No framework, no direct Node/IPC access. Read-only views + the one bounded
// mutation this phase allows: changing a project's stage. No body editing —
// that would drift toward an IDL (anti-goal).
const el = (sel) => document.querySelector(sel);
const listEl = el('#list');
const detailEl = el('#detail');
const searchEl = el('#search');

let stages = [];
let projects = [];
let activeSlug = null;

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) node.append(kid);
  return node;
}

function renderProjectList() {
  listEl.replaceChildren();
  listEl.append(h('div', { class: 'section-label', text: 'Projects' }));
  if (!projects.length) {
    listEl.append(h('div', { class: 'project-card', text: 'No projects yet.' }));
    return;
  }
  for (const p of projects) {
    const card = h(
      'div',
      { class: `project-card${p.slug === activeSlug ? ' active' : ''}`, onclick: () => selectProject(p.slug) },
      h('div', { class: 'name', text: p.name }),
      h('div', { class: 'card-meta' },
        h('span', { class: 'badge stage', text: p.stage ?? '—' }),
        h('span', { class: 'badge', text: p.status ?? '—' })),
    );
    listEl.append(card);
  }
}

function renderSearchResults(hits) {
  listEl.replaceChildren();
  listEl.append(h('div', { class: 'section-label', text: `Results (${hits.length})` }));
  for (const hit of hits) {
    const where = hit.project ? `${hit.type} · ${hit.project}` : hit.type;
    const card = h(
      'div',
      { class: 'result-card', onclick: () => hit.project && selectProject(hit.project) },
      h('div', { class: 'name', text: hit.title }),
      h('div', { class: 'where', text: where }),
    );
    listEl.append(card);
  }
}

function renderDetail(project, timeline) {
  const select = h('select', { class: 'stage-select', onchange: (e) => onStageChange(e.target.value) });
  for (const s of stages) {
    const opt = h('option', { value: s, text: s });
    if (s === project.stage) opt.selected = true;
    select.append(opt);
  }

  const sub = h('div', { class: 'detail-sub' });
  sub.append(document.createTextNode(`status: ${project.status ?? '—'} · created ${project.created ?? '—'}`));
  if (project.repo) sub.append(document.createTextNode(` · repo: ${project.repo}`));
  for (const link of project.links ?? []) {
    sub.append(document.createTextNode(' · '));
    sub.append(h('a', { href: link.url, text: link.label }));
  }

  const timelineEl = h('div', { class: 'timeline' }, h('h2', { text: 'Memory timeline' }));
  if (!timeline.length) {
    timelineEl.append(h('div', { class: 'detail-sub', text: 'No log entries or decisions yet.' }));
  }
  for (const entry of timeline) {
    const kind = entry.type === 'decision' ? `decision #${entry.number}` : 'log';
    const preview = (entry.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    timelineEl.append(
      h('div', { class: 'timeline-entry' },
        h('div', { class: 'when', text: entry.date ?? '' }),
        h('div', { class: 'what' },
          h('div', {},
            h('span', { class: 'kind', text: kind }),
            document.createTextNode(entry.title ?? '')),
          preview ? h('div', { class: 'body', text: preview }) : null)),
    );
  }

  detailEl.replaceChildren(
    h('div', { class: 'detail-head' }, h('h1', { class: 'detail-title', text: project.name }), select),
    sub,
    h('div', { class: 'narrative', text: (project.body ?? '').trim() }),
    timelineEl,
  );
}

async function selectProject(slug) {
  activeSlug = slug;
  renderProjectList();
  const { project, timeline } = await window.verqury.getProject(slug);
  renderDetail(project, timeline);
}

async function onStageChange(stage) {
  if (!activeSlug) return;
  await window.verqury.setStage(activeSlug, stage);
  await refresh();
}

async function refresh() {
  projects = await window.verqury.listProjects();
  if (searchEl.value.trim()) return; // don't clobber an active search in the list
  renderProjectList();
  if (activeSlug) {
    const { project, timeline } = await window.verqury.getProject(activeSlug);
    renderDetail(project, timeline);
  }
}

let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  searchTimer = setTimeout(async () => {
    if (!q) return renderProjectList();
    renderSearchResults(await window.verqury.search(q));
  }, 180);
});

async function init() {
  stages = await window.verqury.getStages();
  projects = await window.verqury.listProjects();
  renderProjectList();
  if (projects.length) await selectProject(projects[0].slug);
  window.verqury.onDataChanged(() => refresh());
  window.__verquryReady = true; // signal for headless verification
}

init();
