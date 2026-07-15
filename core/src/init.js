// Bootstrap a data root. Idempotent: safe to run against an existing root.
import fs from 'node:fs';
import { projectsDir, globalGuidanceDir, approvalsDir, configPath } from './paths.js';
import { defaultConfig, writeConfig } from './config.js';
import { ensureStarterPackets } from './packets.js';
import { ensureStarterAdapters } from './adapters.js';

export function init(root) {
  fs.mkdirSync(projectsDir(root), { recursive: true });
  fs.mkdirSync(globalGuidanceDir(root), { recursive: true });
  // The approval inbox exists from the start so the file watcher (and the relay it
  // drives) sees the first pending decision without a restart (ADR-0011 Phase B).
  fs.mkdirSync(approvalsDir(root), { recursive: true });
  if (!fs.existsSync(configPath(root))) {
    writeConfig(root, defaultConfig());
  }
  ensureStarterPackets(root);
  ensureStarterAdapters(root);
  return root;
}
