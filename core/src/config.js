// config.json lives at the data-root top level (plan §3): hotkeys + adapter
// registry. Adapters stay empty until Phase 7; capture hotkey default is the
// resolved Ctrl+Alt+C.
import fs from 'node:fs';
import { configPath } from './paths.js';

const CONFIG_VERSION = 1;

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    createdAt: new Date().toISOString(),
    hotkeys: { capture: 'Ctrl+Alt+C' },
    adapters: [],
  };
}

export function readConfig(root) {
  return JSON.parse(fs.readFileSync(configPath(root), 'utf8'));
}

export function writeConfig(root, config) {
  fs.writeFileSync(configPath(root), JSON.stringify(config, null, 2) + '\n');
}
