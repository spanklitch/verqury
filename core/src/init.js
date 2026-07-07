// Bootstrap a data root. Idempotent: safe to run against an existing root.
import fs from 'node:fs';
import { projectsDir, globalGuidanceDir, configPath } from './paths.js';
import { defaultConfig, writeConfig } from './config.js';

export function init(root) {
  fs.mkdirSync(projectsDir(root), { recursive: true });
  fs.mkdirSync(globalGuidanceDir(root), { recursive: true });
  if (!fs.existsSync(configPath(root))) {
    writeConfig(root, defaultConfig());
  }
  return root;
}
