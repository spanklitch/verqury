import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, createProject, addLog } from 'verqury-core/files';
import { watchDataRoot } from '../src/watcher.js';

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-watch-'));
  init(dir);
  return dir;
}

test('watchDataRoot fires when a new markdown file lands (the live-update spine)', async () => {
  const root = tmpRoot();
  createProject(root, { name: 'Watched' });

  await new Promise((resolve, reject) => {
    let fired = false;
    const watcher = watchDataRoot(
      root,
      () => {
        if (fired) return;
        fired = true;
        watcher.close();
        resolve();
      },
      { debounceMs: 50 },
    );
    watcher.on('ready', () => addLog(root, 'watched', { text: 'live!', title: 'Live' }));
    setTimeout(() => {
      if (!fired) {
        watcher.close();
        reject(new Error('watcher did not fire within 5s'));
      }
    }, 5000);
  });
});
