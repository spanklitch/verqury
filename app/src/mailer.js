// Remote decision relay — long-form email channel (ADR-0011, Phase C). A deliberately
// POWERLESS read channel: it carries the full context of a clarifying question so the
// owner can read it on the phone, but it NEVER carries an actionable link — all
// authority stays on the one authed Telegram chat_id. The answer always returns via
// Telegram (a tapped option or a typed reply), joined to the email by the #code
// correlation id. The transport is INJECTED so this is testable without real SMTP
// credentials (the app passes a real nodemailer transport; tests pass a fake).
import nodemailer from 'nodemailer';

// Build a Gmail-style SMTP transport from non-secret config + the app-password secret.
// Port 465 = implicit TLS (secure:true); 587 = STARTTLS (secure:false). Defaults → Gmail.
export function makeTransport(cfg, password) {
  const port = Number(cfg.smtpPort) || 465;
  return nodemailer.createTransport({
    host: cfg.smtpHost || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: cfg.from, pass: password },
  });
}

// Send the context email for a question. `transport` need only expose sendMail() — the
// real nodemailer transport in the app, or a fake in tests. Never includes credentials
// or a link; the #code ties it to the Telegram card the owner answers on.
export function sendContextEmail(transport, cfg, { code, summary, body, project }) {
  const subject = `Verqury decision #${code} — ${summary}`.slice(0, 200);
  const text = [
    `Decision #${code}`,
    project ? `Project: ${project}` : null,
    '',
    summary,
    '',
    body || '(no additional context)',
    '',
    '— Respond in Telegram: tap an option or reply to the card. This email is context only.',
  ]
    .filter((l) => l !== null)
    .join('\n');
  return transport.sendMail({ from: cfg.from, to: cfg.to || cfg.from, subject, text });
}
