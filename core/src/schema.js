// Controlled vocabularies from plan §3. Kept central so every writer validates
// against the same lists. Artifact/task enums arrive with their phases (4, 6).
export const STAGES = [
  'concept', 'prd', 'architecture', 'build',
  'test', 'docs', 'release', 'marketing', 'shipped',
];
export const STATUSES = ['active', 'paused', 'shipped', 'archived'];
export const GUIDANCE_KINDS = ['skill', 'standard', 'instruction', 'template'];
export const DECISION_STATUSES = ['proposed', 'accepted', 'superseded'];
export const ARTIFACT_KINDS = ['prompt', 'command', 'snippet', 'report', 'note', 'url'];
export const ARTIFACT_SOURCES = ['clipboard', 'manual', 'report'];
export const TASK_ROUTES = ['direct', 'automation', 'browser-agent', 'human'];
export const TASK_STATUSES = ['todo', 'handed-off', 'in-progress', 'done', 'dropped'];

export function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${label}: "${value}". Expected one of: ${allowed.join(', ')}`);
  }
}

// Today's date as YYYY-MM-DD (local), used for created/updated fields and filenames.
export function today() {
  return new Date().toISOString().slice(0, 10);
}
