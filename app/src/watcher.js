// Live file watcher: the headline behavior of the shell is that edits made on
// disk by a terminal agent show up in the app without a restart. chokidar on
// Linux uses fs.watch (no native module), so this adds no ABI concerns.
import chokidar from 'chokidar';
import { projectsDir, globalGuidanceDir, approvalsDir } from 'verqury-core/files';

// Watches the data root's markdown tree. `onChange` fires (debounced) on any
// add/change/unlink of a .md file. Returns the chokidar watcher (call .close()).
export function watchDataRoot(root, onChange, { debounceMs = 250 } = {}) {
  const watcher = chokidar.watch([projectsDir(root), globalGuidanceDir(root), approvalsDir(root)], {
    ignoreInitial: true,
    persistent: true,
  });

  let timer = null;
  const schedule = (event, file) => {
    if (file && !file.endsWith('.md')) return; // ignore the sqlite index etc.
    clearTimeout(timer);
    timer = setTimeout(() => onChange({ event, file }), debounceMs);
  };

  for (const event of ['add', 'change', 'unlink']) {
    watcher.on(event, (file) => schedule(event, file));
  }
  return watcher;
}
