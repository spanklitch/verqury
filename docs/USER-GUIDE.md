# Verqury — User Guide

**Layer, not IDE.** Verqury doesn't replace your chat AIs, terminal agents, editors, or
browsers — it's the quiet operating layer *around* them. It holds each project's memory,
your reusable guidance, the artifacts you capture, and the tasks you route out, so you keep
context as you move between surfaces from first concept through ship.

> **The one thing to know:** everything Verqury stores is plain Markdown files under
> `~/FlawedWorks/verqury/`. You own them, you can `grep`/edit them, git them, and any
> terminal agent (Claude Code, etc.) can read and write them directly. Verqury is a fast,
> live window onto those files — edit a file in your editor and the app updates within a
> second.

---

## Your first ten minutes

1. **Create a project.** Projects tab → **+ New project**. Give it a name (e.g. "Mebit"),
   pick a stage (start at *concept*), optionally point `Repo path` at its code folder, and
   jot an initial narrative. Create.
2. **Write the narrative.** The narrative is the project's story — concept, current
   thinking, where it stands. Edit it in your own editor at
   `~/FlawedWorks/verqury/projects/<slug>/project.md` (the app shows it live). Keep it in
   the present tense; it's what you'll hand to an AI to get oriented.
3. **Add your guidance.** Guidance tab → **+ New guidance** for the standards/skills/
   instructions you want AIs to follow (security, naming, architecture discipline…).
   Global guidance applies everywhere; project-scoped guidance is specific.
4. **Bootstrap a session.** Open the project → **⚡ Bootstrap** → pick a packet (e.g.
   *chat-ideation*) → **Copy to clipboard** → paste into a chat window. The packet is
   pre-filled with your narrative and recent progress, so you skip the re-explaining.
5. **Capture as you go.** Any time you copy something worth keeping — a good prompt, a
   command, a snippet, a report — hit **Ctrl+Alt+C** (or drag the highlighted text onto the
   Verqury window). It lands in the Inbox, filed to your active project.

That loop — bootstrap a surface, work, capture what matters, feed it back — is the whole
idea. Everything below is detail.

---

## The tabs

### Projects
Your operating record per project.
- **Stage** dropdown tracks the lifecycle: concept → prd → architecture → build → test →
  docs → release → marketing → shipped. (It's a label, not a gate — a shipped project can
  swing back to *build* for the next release.)
- **Launch** buttons run your configured AI surfaces for this project (see Settings). Each
  one copies the surface's handoff packet to your clipboard, then opens the tool.
- **⚡ Bootstrap** renders a context packet for the project (see *Session bootstrapping*).
- **Memory timeline** shows log entries and decisions, newest first. You add these by
  editing files (or with a terminal agent) — see *Recording progress* below.

### Guidance
Your reusable, composable instruction library.
- **+ New guidance** with a kind (skill / standard / instruction / template); the body
  gets a starter scaffold.
- **Copy** drops the guidance text on your clipboard to paste into any AI.
- **Promote to global** lifts a project's guidance into the shared library.
- Bodies are edited in your editor (they're just Markdown files) — the app previews them.

### Inbox
Everything you capture becomes a durable, searchable artifact.
- Capture with **Ctrl+Alt+C** (clipboard) or by **dragging text** onto the window.
- The **Capture to** selector at the top sets the *active project* — where new captures go.
- Each artifact is auto-classified (command / snippet / url / note / prompt / report); you
  can change the kind, edit tags, **Copy back** to the clipboard, or delete.

### Tasks
Route work and close the loop.
- **+ New task** with a route lane: *direct*, *automation*, *browser-agent*, or *human*.
- **Hand off (copy payload)** puts the task's payload — enriched with the surface's packet
  context — on your clipboard and marks it handed-off. Paste it into the agent/person.
- **Attach report**: when the work comes back, capture the report (Ctrl+Alt+C / drag),
  then pick it here. The task is marked done and a completion entry is echoed into the
  project's memory timeline.

### Settings (⚙) — Adapters
Your AI surfaces, defined purely as config.
- Each adapter is `{ label, launch command, handoff packet, notes }`.
- Use `{{repo}}`, `{{project.name}}`, `{{project.slug}}` in the command; Verqury fills them
  in when you click a project's Launch button.
- Ships with Claude Code, Claude Chat, Cursor, and a Browser Agent — edit or add your own.
  Swapping in a new AI tool is a config entry, never a code change.

---

## Session bootstrapping (packets)

Packets are reusable templates that assemble project context for a surface. From a project's
**⚡ Bootstrap** panel, pick a packet, preview it, then **Copy to clipboard** or **Write**
it into the project repo as a context file.

Starter packets:
- **chat-ideation** — narrative + recent progress, for a chat window.
- **terminal-build** — narrative + selected guidance + recent log, written to
  `VERQURY_CONTEXT.md` in the repo for a terminal coding agent.
- **browser-task** — a task brief for a browser agent.

Packet markers you can use when authoring your own (edit files in
`~/FlawedWorks/verqury/packets/`): `{{project.name}}`, `{{project.narrative}}`,
`{{includes}}` (pulls in guidance files listed in the packet's `includes`), and
`{{log:N}}` (the last N log entries).

---

## Recording progress (narrative, log entries, decisions)

Verqury is a workflow layer, not a text editor — so the prose you write lives in files you
edit with your own tools, and the app reflects it live:

- **Narrative:** edit `projects/<slug>/project.md` (the body under the frontmatter).
- **Log entry:** drop a Markdown file in `projects/<slug>/memory/log/`, e.g.
  `2026-07-08-shipped-auth.md` with a `title:` in frontmatter. It appears in the timeline.
- **Decision:** a file in `projects/<slug>/memory/decisions/`, numbered `NNN-slug.md`.

A terminal agent working in your data root can add these for you as you build. (If you'd
rather add log entries and decisions from a button in the app, say so — it's a natural
next addition.)

---

## Handy things

- **Search** (top of the sidebar) is full-text across projects, guidance, memory,
  artifacts, and tasks. Click a result to jump to it.
- **Theme:** the ☾/☀ button in the header toggles dark/light; your choice sticks.
- **Tray:** Verqury stays in the system tray; "Start on login (to tray)" is in the tray
  menu. Close the window and it keeps running for instant capture.
- **Live edits:** anything you or an agent changes on disk shows up in the app within ~1s.
- **It survives Verqury.** Delete the app and your entire operating record is still there
  as readable files. The search index (`index.sqlite`) is the only throwaway — it rebuilds
  itself.
