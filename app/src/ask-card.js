// Rendering an agent's AskUserQuestion into the relay's phone + email channels.
//
// Claude Code's AskUserQuestion arrives as a PERMISSION record whose body is the tool's
// JSON payload — the full question text and every option with its description. Relayed
// as a bare "Approve this?" card it was useless: you had to walk back to the terminal
// just to learn what was being asked.
//
// Hard limit worth knowing: the PermissionRequest contract is allow/deny ONLY — there is
// no channel to hand a chosen option back to the tool. So the phone's job here is to let
// you READ the question (long form by email); the answer still happens at the desk. True
// answer-from-phone is what the verqury-ask skill is for.
//
// Pure functions, no Electron: parsing one agent's payload shape is app knowledge, not
// core domain (ADR-0001 keeps core pure file I/O), and this stays unit-testable.

export const TELEGRAM_TEXT_LIMIT = 3500; // real cap is 4096; leave room and never lose the footer

// Parse an AskUserQuestion payload into questions + options. Returns null for anything
// that isn't one (bad JSON, another tool, no questions) so callers fall back to the
// plain permission card.
export function parseAskPayload(body) {
  let parsed;
  try {
    parsed = JSON.parse(body || '');
  } catch {
    return null;
  }
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  if (!questions.length) return null;
  const digest = questions
    .map((q) => ({
      question: String(q?.question || '').trim(),
      options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({
        label: String(o?.label || '').trim(),
        description: String(o?.description || '').trim(),
      })),
    }))
    .filter((q) => q.question);
  return digest.length ? digest : null;
}

const letter = (i) => String.fromCharCode(65 + i);

// The readable card: question(s) + option LABELS, so the phone says what is being decided.
// Descriptions go to email — they never fit here.
export function askCardText({ code, project, sessionId }, digest, emailed) {
  const head = [`💬 Answer needed #${code}`];
  const body = [];
  digest.forEach((q, i) => {
    body.push('', digest.length > 1 ? `${i + 1}. ${q.question}` : q.question);
    q.options.forEach((o, j) => body.push(`   ${letter(j)}) ${o.label}`));
  });
  const foot = [''];
  if (emailed) foot.push('📧 Full options emailed.');
  foot.push('✅ Approve to answer at your desk · ⛔ Deny to cancel.');
  const meta = [project && `📁 ${project}`, sessionId && `#${sessionId}`].filter(Boolean).join('  ');
  if (meta) foot.push(meta);

  // Measure the assembled card rather than estimating its fixed parts — the join adds
  // separators that are easy to miscount, and overshooting the cap drops the message.
  let text = body.join('\n');
  const assemble = () => [...head, text, ...foot].join('\n');
  const over = assemble().length - TELEGRAM_TEXT_LIMIT;
  if (over > 0) text = `${text.slice(0, Math.max(0, text.length - over - 3))}...`;
  return assemble();
}

// Long-form context: every option WITH its description — the part a card cannot carry.
export function askEmailBody(digest) {
  const out = [];
  digest.forEach((q, i) => {
    out.push(digest.length > 1 ? `${i + 1}. ${q.question}` : q.question, '');
    q.options.forEach((o, j) => {
      out.push(`  ${letter(j)}) ${o.label}`);
      if (o.description) out.push(`     ${o.description}`);
    });
    out.push('');
  });
  return out.join('\n').trim();
}
