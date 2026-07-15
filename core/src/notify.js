// Remote decision relay — notification settings (ADR-0011, plan §8 Phase A).
// Non-secret config only: Here/Away presence, an enable flag, and the Telegram
// chat_id, all in config.json (like the adapter registry). The bot token is a
// SECRET and lives in ~/.claude/.env, never here — this module never sees it.
// Verqury stays a relay: this records where the owner is; it never decides.
import { readConfig, writeConfig } from './config.js';

export const PRESENCE = ['here', 'away'];

// HERE = local bell/tab (ADR-0010); AWAY = notify the phone. Email fields exist
// but stay inert until Phase C — surfaced so the UI can preview the shape.
export function defaultNotify() {
  return {
    presence: 'here',
    enabled: false,
    telegram: { chatId: '' },
    email: { to: '', from: '', smtpHost: '', smtpPort: '' }, // inert until Phase C
  };
}

export function getNotify(root) {
  let stored = {};
  try {
    stored = readConfig(root).notify ?? {};
  } catch {
    stored = {};
  }
  const d = defaultNotify();
  return {
    ...d,
    ...stored,
    telegram: { ...d.telegram, ...(stored.telegram ?? {}) },
    email: { ...d.email, ...(stored.email ?? {}) },
  };
}

export function setPresence(root, presence) {
  if (!PRESENCE.includes(presence)) throw new Error(`Invalid presence: ${presence} (use here|away)`);
  return patchNotify(root, { presence });
}

// Shallow-merge a patch into config.notify, one level deep for telegram/email.
export function updateNotify(root, patch = {}) {
  return patchNotify(root, patch);
}

function patchNotify(root, patch) {
  const config = readConfig(root);
  const current = config.notify ?? {};
  config.notify = {
    ...current,
    ...patch,
    telegram: { ...(current.telegram ?? {}), ...(patch.telegram ?? {}) },
    email: { ...(current.email ?? {}), ...(patch.email ?? {}) },
  };
  writeConfig(root, config);
  return getNotify(root);
}
