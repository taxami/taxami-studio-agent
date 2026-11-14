#!/usr/bin/env node
/**
 * e2e-agent.mjs — esegue l'agente (eseguibile o sorgente) contro un finto
 * server: nessun token reale, nessuna rete, nessun file dell'utente.
 *
 * Copre quello che nessun test copriva prima: il ciclo di poll vero, il
 * controllo dei percorsi dentro allowedDirs (compreso il collegamento che esce,
 * la garanzia v3.1) e il POST del risultato. Dal 2026-10-27 è lo step che in CI
 * esegue il binario Windows compilato, non solo lo script.
 *
 *   node scripts/e2e-agent.mjs                          # esegue lo script sorgente
 *   node scripts/e2e-agent.mjs --bin dist/TaxamiStudioAgent.exe --expect-version 3.1.0
 *   node scripts/e2e-agent.mjs --script /tmp/vecchio-agent.js   # controllo negativo
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'e2e-token-non-reale';

function fail(message) {
  console.error('[e2e] FALLITO: ' + message);
  process.exitCode = 1;
}

const argv = process.argv.slice(2);
const opts = { bin: null, script: null, expectVersion: null, timeoutMs: 45000 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--bin') opts.bin = path.resolve(argv[++i]);
  else if (argv[i] === '--script') opts.script = path.resolve(argv[++i]);
  else if (argv[i] === '--expect-version') opts.expectVersion = argv[++i];
  else if (argv[i] === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
  else {
    console.error('[e2e] argomento sconosciuto: ' + argv[i]);
    process.exit(2);
  }
}

if (!opts.expectVersion) {
  opts.expectVersion = opts.bin
    ? readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim()
    : 'dev';
}

const root = mkdtempSync(path.join(os.tmpdir(), 'taxami-agent-e2e-'));
const home = path.join(root, 'home');
const allowedDir = path.join(home, 'Documents');
const outsideDir = path.join(root, 'fuori-dalle-allowed-dirs');
mkdirSync(path.join(home, '.taxami-studio-agent'), { recursive: true });
mkdirSync(allowedDir, { recursive: true });
mkdirSync(outsideDir, { recursive: true });
writeFileSync(path.join(allowedDir, 'report.txt'), 'contenuto-di-prova\n', 'utf8');
writeFileSync(path.join(outsideDir, 'segreto.txt'), 'segreto\n', 'utf8');

// Collegamento dentro allowedDirs che punta fuori: su Windows una junction non
// richiede privilegi, altrove un normale symlink di directory.
let escapeLink = null;
try {
  const link = path.join(allowedDir, 'link-esterno');
  symlinkSync(outsideDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  escapeLink = link;
} catch {
  console.log('[e2e] SKIP: questa macchina non consente di creare collegamenti');
}

const cases = [
  {
    id: 'dentro',
    action: 'pc_read_file',
    params: { path: path.join(allowedDir, 'report.txt') },
    check: (r) => r.ok === true && String(r.result).includes('contenuto-di-prova'),
    describe: 'lettura dentro allowedDirs',
  },
  {
    id: 'fuori',
    action: 'pc_read_file',
    params: { path: path.join(outsideDir, 'segreto.txt') },
    check: (r) => r.ok === false && /non autorizzato/i.test(String(r.error)),
    describe: 'lettura fuori dalle allowedDirs rifiutata',
  },
  {
    id: 'collegamento', skip: !escapeLink,
    action: 'pc_read_file',
    params: { path: escapeLink ? path.join(escapeLink, 'segreto.txt') : '' },
    check: (r) => r.ok === false && /non autorizzato/i.test(String(r.error)),
    describe: 'collegamento che esce dalle allowedDirs rifiutato',
  },
].filter((c) => !c.skip);

const results = new Map();
let nextCase = 0;
const seen = { poll: 0, version: null, allowedDirs: null, auth: null };

let settle;
const finished = new Promise((resolve) => { settle = resolve; });
let failure = null;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + TOKEN) {
      failure = 'autorizzazione inattesa: ' + JSON.stringify(auth);
      return send(401, { error: 'token non valido' });
    }

    if (req.method === 'POST' && req.url === '/api/studio/agent/poll') {
      seen.poll += 1;
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* body non JSON */ }
      seen.version = body.version ?? null;
      seen.allowedDirs = Array.isArray(body.allowedDirs) ? body.allowedDirs : null;
      const current = cases[nextCase];
      if (!current) return send(200, { op: null });
      nextCase += 1;
      return send(200, { op: { id: current.id, action: current.action, params: current.params } });
    }

    const match = /^\/api\/studio\/agent\/ops\/([^/]+)\/result$/.exec(req.url || '');
    if (req.method === 'POST' && match) {
      const id = decodeURIComponent(match[1]);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* body non JSON */ }
      results.set(id, body);
      send(200, { ok: true });
      if (results.size === cases.length) settle();
      return;
    }

    send(404, { error: 'rotta non gestita dal finto server: ' + req.method + ' ' + req.url });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

writeFileSync(
  path.join(home, '.taxami-studio-agent', 'config.json'),
  JSON.stringify(
    { token: TOKEN, baseUrl: 'http://127.0.0.1:' + port, allowedDirs: [allowedDir], label: 'CI-E2E' },
    null,
    2
  ),
  'utf8'
);

const env = { ...process.env, HOME: home, USERPROFILE: home };
delete env.TAXAMI_AGENT_TOKEN;
delete env.TAXAMI_AGENT_BASEURL;
// Se restasse '1' l'agente caricherebbe il modulo senza avviarsi (guardia dei test).
delete env.TAXAMI_STUDIO_AGENT_NO_MAIN;

const child = opts.bin
  ? spawn(opts.bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  : spawn(process.execPath, [opts.script || path.join(ROOT, 'studio-agent.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });

const timer = setTimeout(() => {
  failure = failure || ('timeout: ' + results.size + '/' + cases.length + ' risultati dopo ' + opts.timeoutMs + ' ms');
  settle();
}, opts.timeoutMs);

await finished;
clearTimeout(timer);
child.kill();
server.close();

// ─── Verifiche ──────────────────────────────────────────────────────────────
const problems = [];
if (failure) problems.push(failure);

if (seen.poll === 0) problems.push('nessun poll ricevuto');
if (seen.version !== opts.expectVersion) {
  problems.push('versione nel poll ' + JSON.stringify(seen.version) + ', attesa ' + JSON.stringify(opts.expectVersion));
}
if (!seen.allowedDirs || !seen.allowedDirs.includes(allowedDir)) {
  problems.push('allowedDirs nel poll non corrispondenti: ' + JSON.stringify(seen.allowedDirs));
}
if (!stdout.includes('[TaxAmi Studio Agent] ' + opts.expectVersion)) {
  problems.push('banner di avvio senza la versione attesa ' + opts.expectVersion);
}

for (const testCase of cases) {
  const result = results.get(testCase.id);
  if (!result) {
    problems.push('nessun risultato per il caso ' + testCase.id);
    continue;
  }
  if (!testCase.check(result)) {
    problems.push('caso "' + testCase.describe + '" non superato: ' + JSON.stringify(result).slice(0, 300));
  }
}

rmSync(root, { recursive: true, force: true });

if (problems.length > 0) {
  fail(problems.join('\n[e2e] FALLITO: '));
  console.error('[e2e] --- stdout agente ---\n' + stdout.trim());
  console.error('[e2e] --- stderr agente ---\n' + stderr.trim());
  process.exit(1);
}

console.log(
  '[e2e] OK: ' + cases.length + ' casi, ' + seen.poll + ' poll, versione ' + opts.expectVersion +
    ' (' + (opts.bin ? path.relative(ROOT, opts.bin) : path.relative(ROOT, opts.script || path.join(ROOT, 'studio-agent.js'))) + ')'
);
