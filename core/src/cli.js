#!/usr/bin/env node
// verqury CLI — a thin layer over verqury-core. Domain calls do pure file I/O;
// this layer refreshes the search index after any mutation so `search` stays
// current without a running watcher (ADR-0001 / ADR-0002).
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { resolveRoot } from './paths.js';
import { VERSION } from './index.js';
import { init } from './init.js';
import { readConfig, getActiveProject, setActiveProject } from './config.js';
import * as projects from './projects.js';
import * as guidance from './guidance.js';
import * as memory from './memory.js';
import * as artifacts from './artifacts.js';
import * as packets from './packets.js';
import * as tasks from './tasks.js';
import * as adapters from './adapters.js';
import * as notify from './notify.js';
import * as approvals from './approvals.js';
import * as search from './search.js';

const OPTIONS = {
  'data-root': { type: 'string' },
  slug: { type: 'string' },
  stage: { type: 'string' },
  status: { type: 'string' },
  repo: { type: 'string' },
  link: { type: 'string', multiple: true },
  kind: { type: 'string' },
  scope: { type: 'string' },
  tag: { type: 'string', multiple: true },
  title: { type: 'string' },
  body: { type: 'string' },
  project: { type: 'string' },
  type: { type: 'string' },
  limit: { type: 'string' },
  out: { type: 'string' },
  log: { type: 'string' },
  route: { type: 'string' },
  surface: { type: 'string' },
  summary: { type: 'string' },
  options: { type: 'string' },
  'needs-context': { type: 'boolean' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  resume: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const USAGE = `verqury ${VERSION} — layer, not IDE

Usage: verqury <command> [args] [--data-root <dir>]

  init                                 Bootstrap the data root
  project create <name> [--slug s] [--stage s] [--status s] [--repo p] [--link label=url]
  project list
  project show <slug>
  project set-stage <slug> <stage>
  guidance add <title> --kind <k> [--scope global|<project>] [--slug s] [--tag t] [--body text|-]
  guidance list [--scope global|<project>] [--all]
  guidance show <slug> [--scope global|<project>]
  guidance promote <project> <slug>    Move project guidance to the global library
  log add <project> <text...>          [--title t]  (or --body -/text)
  decision add <project> <title...>    [--body text|-]
  artifact add <project> <content...>  [--kind k] [--tag t] [--title t] (or --body -)
  artifact list [--project s] [--kind k] [--json]
  active [<project>]                   Get or set the project new captures file into
  adapter list                         Configured AI surfaces (launch/handoff)
  notify [here|away|enable|disable|chat-id <id>]   Remote-relay presence + Telegram (ADR-0011)
  approval list [--status pending|answered|expired] [--json]   Remote decision inbox (Phase B/C)
  approval answer <id> <allow|deny>    Record a verdict on a pending permission
  approval ask --summary <s> [--options a|b|c] [--body <t>] [--project <slug>] [--needs-context]
                                       File a clarifying question (Phase C; normally the verqury-ask skill)
  approval reply <id> <answer...>      Record a free-text answer to a pending question
  approval expire <id>                 Park a pending decision at the desk
  packet list
  packet render <packet> <project>     Render a bootstrap packet [--out file] [--log N]
  task add <project> <title...>        [--route r] [--surface s] [--resume] (or --body -)
  task list [--project s] [--route r] [--status s]
  task resume <project> <id> [on|off]  Flag a task to surface when Verqury opens
  task status <project> <id> <status>
  task handoff <project> <id>          Print the hand-off payload
  task report <project> <id> <artifactId>   Attach a report → done → log entry
  search <query...> [--project s] [--type project|guidance|decision|log|artifact] [--limit n] [--json]
  timeline <project>                   Log + decisions, newest first
  index rebuild | refresh
  config show

Data root resolves from --data-root, then $VERQURY_DATA_ROOT, then ~/FlawedWorks/verqury.`;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function stdinBody() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// --body value; '-' means read stdin.
function bodyFrom(values) {
  if (values.body === undefined) return '';
  return values.body === '-' ? stdinBody() : values.body;
}

function parseLinks(arr) {
  return (arr || []).map((s) => {
    const i = s.indexOf('=');
    return i === -1 ? { label: s, url: s } : { label: s.slice(0, i), url: s.slice(i + 1) };
  });
}

function printProject(p) {
  console.log(`# ${p.name}  (${p.slug})`);
  console.log(`stage: ${p.stage}   status: ${p.status}   created: ${p.created}`);
  if (p.repo) console.log(`repo: ${p.repo}`);
  if (p.links?.length) for (const l of p.links) console.log(`link: ${l.label} — ${l.url}`);
  console.log('');
  console.log(p.body.trim());
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(err.message);
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  const root = resolveRoot(values['data-root']);
  const [cmd, sub] = positionals;
  const afterMutation = () => search.refreshIndex(root);

  switch (cmd) {
    case 'init': {
      init(root);
      search.refreshIndex(root);
      console.log(`Initialized Verqury data root at ${root}`);
      return;
    }

    case 'project': {
      if (sub === 'create') {
        const name = positionals.slice(2).join(' ');
        if (!name) fail('project create needs a <name>');
        const p = projects.createProject(root, {
          name,
          slug: values.slug,
          stage: values.stage ?? 'concept',
          status: values.status ?? 'active',
          repo: values.repo ?? null,
          links: parseLinks(values.link),
        });
        afterMutation();
        console.log(`Created project: ${p.slug}`);
        return;
      }
      if (sub === 'list') {
        const list = projects.listProjects(root);
        if (!list.length) return console.log('(no projects)');
        for (const p of list) console.log(`${p.slug}\t${p.stage}\t${p.status}\t${p.name}`);
        return;
      }
      if (sub === 'show') {
        const slug = positionals[2];
        if (!slug) fail('project show needs a <slug>');
        printProject(projects.showProject(root, slug));
        return;
      }
      if (sub === 'set-stage') {
        const [, , slug, stage] = positionals;
        if (!slug || !stage) fail('project set-stage needs <slug> <stage>');
        projects.setStage(root, slug, stage);
        afterMutation();
        console.log(`${slug} → stage: ${stage}`);
        return;
      }
      return fail(`unknown project subcommand: ${sub ?? '(none)'}`);
    }

    case 'guidance': {
      if (sub === 'add') {
        const title = positionals.slice(2).join(' ');
        if (!title) fail('guidance add needs a <title>');
        if (!values.kind) fail('guidance add needs --kind');
        const g = guidance.addGuidance(root, {
          scope: values.scope ?? 'global',
          title,
          slug: values.slug,
          kind: values.kind,
          tags: values.tag ?? [],
          body: bodyFrom(values),
        });
        afterMutation();
        console.log(`Added guidance: ${g.scope}/${g.slug}`);
        return;
      }
      if (sub === 'list') {
        const list = values.all
          ? guidance.listAllGuidance(root)
          : guidance.listGuidance(root, { scope: values.scope ?? 'global' });
        if (!list.length) return console.log('(no guidance)');
        for (const g of list) console.log(`${g.scope}\t${g.slug}\t${g.kind}\t${g.title}`);
        return;
      }
      if (sub === 'promote') {
        const [, , project, slug] = positionals;
        if (!project || !slug) fail('guidance promote needs <project> <slug>');
        const g = guidance.promoteGuidance(root, project, slug);
        afterMutation();
        console.log(`Promoted to global: ${g.slug}`);
        return;
      }
      if (sub === 'show') {
        const slug = positionals[2];
        if (!slug) fail('guidance show needs a <slug>');
        const g = guidance.showGuidance(root, values.scope ?? 'global', slug);
        console.log(`# ${g.title}  (${g.kind})\n`);
        console.log(g.body.trim());
        return;
      }
      return fail(`unknown guidance subcommand: ${sub ?? '(none)'}`);
    }

    case 'log': {
      if (sub !== 'add') return fail(`unknown log subcommand: ${sub ?? '(none)'}`);
      const project = positionals[2];
      if (!project) fail('log add needs a <project>');
      const text = positionals.slice(3).join(' ') || bodyFrom(values);
      const l = memory.addLog(root, project, { text, title: values.title });
      afterMutation();
      console.log(`Logged to ${project}: ${l.path}`);
      return;
    }

    case 'decision': {
      if (sub !== 'add') return fail(`unknown decision subcommand: ${sub ?? '(none)'}`);
      const project = positionals[2];
      if (!project) fail('decision add needs a <project>');
      const title = positionals.slice(3).join(' ');
      if (!title) fail('decision add needs a <title>');
      const d = memory.addDecision(root, project, { title, body: bodyFrom(values) });
      afterMutation();
      console.log(`Decision ${String(d.number).padStart(3, '0')} recorded for ${project}`);
      return;
    }

    case 'search': {
      const query = positionals.slice(1).join(' ');
      if (!query) fail('search needs a <query>');
      const hits = search.search(root, query, {
        project: values.project,
        type: values.type,
        limit: values.limit ? Number(values.limit) : undefined,
      });
      if (values.json) return void console.log(JSON.stringify(hits));
      if (!hits.length) return console.log('(no matches)');
      for (const h of hits) {
        const where = h.project ? `${h.type}/${h.project}` : h.type;
        console.log(`${where}\t${h.title}`);
        console.log(`  ${h.snippet.replace(/\s+/g, ' ').trim()}`);
        console.log(`  ${h.path}`);
      }
      return;
    }

    case 'artifact': {
      if (sub === 'add') {
        const project = positionals[2];
        if (!project) fail('artifact add needs a <project>');
        const content = positionals.slice(3).join(' ') || bodyFrom(values);
        const a = artifacts.addArtifact(root, project, {
          content,
          kind: values.kind,
          tags: values.tag ?? [],
          title: values.title,
          source: 'manual',
        });
        afterMutation();
        console.log(`Captured ${a.kind} → ${project}/${a.id}`);
        return;
      }
      if (sub === 'list') {
        const list = artifacts.listArtifacts(root, { project: values.project, kind: values.kind });
        if (values.json) return void console.log(JSON.stringify(list));
        if (!list.length) return console.log('(no artifacts)');
        for (const a of list) console.log(`${a.captured}\t${a.kind}\t${a.project}\t${a.preview}`);
        return;
      }
      return fail(`unknown artifact subcommand: ${sub ?? '(none)'}`);
    }

    case 'active': {
      const slug = positionals[1];
      if (!slug) return void console.log(getActiveProject(root) ?? '(none)');
      projects.showProject(root, slug); // validate it exists
      setActiveProject(root, slug);
      console.log(`Active project: ${slug}`);
      return;
    }

    case 'packet': {
      if (sub === 'list') {
        const list = packets.listPackets(root);
        if (!list.length) return console.log('(no packets)');
        for (const p of list) console.log(`${p.slug}\t${p.surface ?? '—'}\t${p.title}`);
        return;
      }
      if (sub === 'render') {
        const [, , packetSlug, projectSlug] = positionals;
        if (!packetSlug || !projectSlug) fail('packet render needs <packet> <project>');
        const opts = values.log ? { logN: Number(values.log) } : {};
        const rendered = packets.renderPacket(root, packetSlug, projectSlug, opts);
        if (values.out) {
          fs.writeFileSync(values.out, rendered.text);
          console.log(`Wrote ${values.out}`);
        } else {
          process.stdout.write(rendered.text);
        }
        return;
      }
      return fail(`unknown packet subcommand: ${sub ?? '(none)'}`);
    }

    case 'task': {
      if (sub === 'add') {
        const project = positionals[2];
        if (!project) fail('task add needs a <project>');
        const title = positionals.slice(3).join(' ');
        if (!title) fail('task add needs a <title>');
        const t = tasks.addTask(root, project, {
          title,
          route: values.route ?? 'direct',
          surface: values.surface ?? null,
          body: bodyFrom(values),
          resume: Boolean(values.resume),
        });
        afterMutation();
        console.log(`Task ${t.id} (${t.route}) → ${project}`);
        return;
      }
      if (sub === 'resume') {
        const [, , project, id, onoff] = positionals;
        if (!project || !id) fail('task resume needs <project> <id>');
        const on = onoff !== 'off';
        tasks.updateTask(root, project, id, { resume: on });
        afterMutation();
        console.log(`${id} resume ${on ? 'on' : 'off'}`);
        return;
      }
      if (sub === 'list') {
        const list = tasks.listTasks(root, { project: values.project, route: values.route, status: values.status });
        if (values.json) return void console.log(JSON.stringify(list));
        if (!list.length) return console.log('(no tasks)');
        for (const t of list) console.log(`${t.status}\t${t.route}\t${t.project}\t${t.title}`);
        return;
      }
      if (sub === 'status') {
        const [, , project, id, status] = positionals;
        if (!project || !id || !status) fail('task status needs <project> <id> <status>');
        tasks.updateTask(root, project, id, { status });
        afterMutation();
        console.log(`${id} → ${status}`);
        return;
      }
      if (sub === 'handoff') {
        const [, , project, id] = positionals;
        if (!project || !id) fail('task handoff needs <project> <id>');
        process.stdout.write(tasks.renderHandoff(root, project, id).payload);
        return;
      }
      if (sub === 'report') {
        const [, , project, id, artifactId] = positionals;
        if (!project || !id || !artifactId) fail('task report needs <project> <id> <artifactId>');
        tasks.attachReport(root, project, id, artifactId);
        afterMutation();
        console.log(`Task ${id} done; report ${artifactId} logged`);
        return;
      }
      return fail(`unknown task subcommand: ${sub ?? '(none)'}`);
    }

    case 'notify': {
      // Remote-relay presence + Telegram config (ADR-0011). The bot token is a
      // secret and is NOT handled here — it lives in ~/.claude/.env.
      if (!sub) {
        const n = notify.getNotify(root);
        console.log(`presence: ${n.presence}`);
        console.log(`enabled:  ${n.enabled}`);
        console.log(`chat_id:  ${n.telegram.chatId || '(unset)'}`);
        return;
      }
      if (sub === 'here' || sub === 'away') {
        notify.setPresence(root, sub);
        console.log(`presence: ${sub}`);
        return;
      }
      if (sub === 'enable' || sub === 'disable') {
        notify.updateNotify(root, { enabled: sub === 'enable' });
        console.log(`enabled: ${sub === 'enable'}`);
        return;
      }
      if (sub === 'chat-id') {
        const id = positionals[2];
        if (!id) fail('notify chat-id needs a <chat_id>');
        notify.updateNotify(root, { telegram: { chatId: id } });
        console.log(`chat_id: ${id}`);
        return;
      }
      return fail(`unknown notify subcommand: ${sub}`);
    }

    case 'approval': {
      // Remote approval inbox (ADR-0011, Phase B). The hook writes pending records;
      // this exposes them for scripting/inspection and lets a verdict be recorded.
      if (sub === 'list' || !sub) {
        const list = approvals.listApprovals(root, values.status ? { status: values.status } : {});
        if (values.json) return void console.log(JSON.stringify(list));
        if (!list.length) return console.log('(no approvals)');
        for (const a of list) console.log(`${a.id}\t${a.kind}\t${a.status}\t${a.decision ?? a.answer ?? '—'}\t${a.summary ?? ''}`);
        return;
      }
      if (sub === 'answer') {
        const id = positionals[2];
        const decision = positionals[3];
        if (!id || !decision) fail('approval answer needs <id> <allow|deny>');
        const a = approvals.answerApproval(root, id, decision);
        console.log(`${a.id}: ${a.decision}`);
        return;
      }
      if (sub === 'ask') {
        if (!values.summary) fail('approval ask needs --summary <s>');
        const q = approvals.createQuestion(root, {
          summary: values.summary,
          options: values.options ? values.options.split('|').map((o) => o.trim()).filter(Boolean) : [],
          body: values.body ?? '',
          project: values.project ?? null,
          needsContext: Boolean(values['needs-context']),
        });
        console.log(values.json ? JSON.stringify(q) : `${q.id}: question filed`);
        return;
      }
      if (sub === 'reply') {
        const id = positionals[2];
        const answer = positionals.slice(3).join(' ');
        if (!id || !answer) fail('approval reply needs <id> <answer...>');
        const a = approvals.answerQuestion(root, id, answer);
        console.log(`${a.id}: ${a.answer}`);
        return;
      }
      if (sub === 'expire') {
        const id = positionals[2];
        if (!id) fail('approval expire needs an <id>');
        const a = approvals.expireApproval(root, id);
        console.log(`${a.id}: ${a.status}`);
        return;
      }
      return fail(`unknown approval subcommand: ${sub}`);
    }

    case 'adapter': {
      if (sub === 'list') {
        const list = adapters.listAdapters(root);
        if (values.json) return void console.log(JSON.stringify(list));
        if (!list.length) return console.log('(no adapters)');
        for (const a of list) console.log(`${a.slug}\t${a.packet ?? '—'}\t${a.label}\t${a.command}`);
        return;
      }
      return fail(`unknown adapter subcommand: ${sub ?? '(none)'}`);
    }

    case 'timeline': {
      const project = positionals[1];
      if (!project) fail('timeline needs a <project>');
      const entries = memory.projectTimeline(root, project);
      if (values.json) return void console.log(JSON.stringify(entries));
      if (!entries.length) return console.log('(no memory yet)');
      for (const e of entries) {
        const label = e.type === 'decision' ? `decision #${e.number}` : 'log';
        console.log(`${e.date}\t${label}\t${e.title ?? ''}`);
      }
      return;
    }

    case 'index': {
      if (sub === 'rebuild') return void console.log(`Rebuilt index: ${search.rebuildIndex(root)} documents`);
      if (sub === 'refresh') return void console.log(`Refreshed index: ${search.refreshIndex(root)} changes`);
      return fail(`unknown index subcommand: ${sub ?? '(none)'}`);
    }

    case 'config': {
      if (sub === 'show') return void console.log(JSON.stringify(readConfig(root), null, 2));
      return fail(`unknown config subcommand: ${sub ?? '(none)'}`);
    }

    default:
      return fail(`unknown command: ${cmd}`);
  }
}

try {
  main();
} catch (err) {
  fail(err.message);
}
