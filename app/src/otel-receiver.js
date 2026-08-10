// The OTLP receiver (ADR-0014). A plain node:http listener — no collector binary, no
// new dependency — that accepts the metrics Verqury-launched Claude Code sessions push
// and hands the body to core for ingest.
//
// Deliberately Electron-free so it is testable under plain Node (ADR-0002), and bound
// to LOOPBACK ONLY: this is the one place Verqury opens a port, and nothing outside the
// machine has any business posting to it.
import http from 'node:http';

const MAX_BODY_BYTES = 4 * 1024 * 1024; // an export is a few KB; this is a sanity ceiling

export function createOtelReceiver({ port, host = '127.0.0.1', onPayload }) {
  let server = null;

  function handle(req, res) {
    // OTLP is POST-only. Anything else gets a flat 404 rather than a description of
    // what lives here.
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooBig = true;
        res.writeHead(413).end();
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        onPayload(body);
      } catch {
        /* a bad payload must never take the listener down with it */
      }
      // OTLP/HTTP expects a JSON body; an empty object is a valid success response.
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  }

  return {
    // Resolves to the bound port (never rejects): a port already in use must degrade
    // the meter, not stop the app from starting (ADR-0014 — the receiver is optional).
    start() {
      return new Promise((resolve) => {
        if (server) return resolve(port);
        server = http.createServer(handle);
        server.once('error', () => {
          server = null;
          resolve(null); // most likely EADDRINUSE — a real collector, or a stale instance
        });
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => {
          server = null;
          resolve();
        });
      });
    },
    get running() {
      return Boolean(server);
    },
  };
}
