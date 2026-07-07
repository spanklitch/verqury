// Filesystem layout for a Verqury data root (plan §3).
// The data root is user data, distinct from this app repo. Location resolves from
// an explicit argument, then $VERQURY_DATA_ROOT, then the default under $HOME.
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ROOT = path.join(os.homedir(), 'FlawedWorks', 'verqury');

export function resolveRoot(explicit) {
  return explicit || process.env.VERQURY_DATA_ROOT || DEFAULT_ROOT;
}

export function configPath(root) {
  return path.join(root, 'config.json');
}

export function indexPath(root) {
  return path.join(root, 'index.sqlite');
}

export function globalGuidanceDir(root) {
  return path.join(root, 'guidance');
}

export function projectsDir(root) {
  return path.join(root, 'projects');
}

export function packetsDir(root) {
  return path.join(root, 'packets');
}

// All paths inside a single project's directory.
export function projectPaths(root, slug) {
  const base = path.join(projectsDir(root), slug);
  return {
    base,
    file: path.join(base, 'project.md'),
    guidance: path.join(base, 'guidance'),
    decisions: path.join(base, 'memory', 'decisions'),
    log: path.join(base, 'memory', 'log'),
    artifacts: path.join(base, 'artifacts'),
    tasks: path.join(base, 'tasks'),
    packets: path.join(base, 'packets'),
  };
}
