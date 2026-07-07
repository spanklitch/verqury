import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../src/init.js';

// Fresh, initialized data root in the OS temp dir. No cleanup: /tmp is ephemeral.
export function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verqury-test-'));
  init(dir);
  return dir;
}
