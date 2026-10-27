/**
 * TaxAmi Studio — Agente locale PC
 * =====================================
 * Prerequisiti: Node.js 18+ (usa fetch globale built-in)
 *
 * Configurazione:
 *   Al primo avvio, se manca il token e la console è interattiva (doppio
 *   click sull'exe o lancio da terminale), l'agente chiede il token e crea
 *   da solo il file di configurazione (vedi v2.1 sotto). In alternativa,
 *   puoi crearlo a mano:
 *
 *   Creare il file: ~/.taxami-studio-agent/config.json
 *   Contenuto:
 *   {
 *     "token": "<token agente>",
 *     "baseUrl": "https://www.taxami.it",
 *     "allowedDirs": ["C:\\Users\\nome\\Documenti", "C:\\Users\\nome\\Desktop"],
 *     "workspaceDir": "(opzionale)",
 *     "label": "(opzionale, es. PC-Silvia)"
 *   }
 *
 *   Variabili d'ambiente (sovrascrivono config):
 *     TAXAMI_AGENT_TOKEN    — token di autenticazione
 *     TAXAMI_AGENT_BASEURL  — URL base (default: https://www.taxami.it)
 *
 * Avvio:
 *   node studio-agent.js
 *
 * Sicurezza:
 *   - Accede SOLO alle cartelle elencate in allowedDirs
 *   - Ogni percorso viene verificato prima dell'accesso
 *
 * v2: lettura binaria + scrittura file/Excel
 *   - Le scritture arrivano SOLO dopo conferma dell'utente sulla webapp
 *   - Mai sovrascrittura: auto-rinomina con suffisso (2), (3), …
 *
 * v3: info file (data modifica/dimensione), copia file, sposta/rinomina file
 *   - Info file è sola lettura, copia/sposta richiedono conferma come le scritture
 *
 * v2.1: mai più uscita silenziosa + wizard al primo avvio
 *   - Doppio click sull'exe e console che si chiude in un lampo su errore
 *     (config mancante/token assente): ora, se stdin è un terminale
 *     interattivo (TTY), la finestra resta aperta finché non premi INVIO.
 *   - Se manca il token e la console è interattiva, un piccolo wizard
 *     chiede il token (link alla pagina dove generarlo) e crea da solo
 *     ~/.taxami-studio-agent/config.json, poi avvia l'agente normalmente.
 *
 * v2.2: baseUrl di default con www (evita 401 "fantasma")
 *   - https://taxami.it risponde con un redirect 308 verso
 *     https://www.taxami.it: il fetch nativo di Node scarta l'header
 *     Authorization nei redirect cross-host, quindi ogni poll tornava 401
 *     "token non valido" anche con un token corretto. Il default e le
 *     configurazioni esistenti senza www vengono ora normalizzati
 *     automaticamente su https://www.taxami.it.
 *
 * v3.1: collegamenti simbolici e junction non escono più da allowedDirs
 *   - Il controllo dei percorsi era solo testuale (path.resolve): un
 *     collegamento simbolico o una junction DENTRO una cartella autorizzata
 *     che punta FUORI faceva leggere o scrivere fuori. Ora il percorso deve
 *     stare in una cartella autorizzata sia come testo sia dopo aver risolto
 *     i collegamenti (fs.realpath); per un file ancora da creare si risolve
 *     la cartella esistente più vicina; un collegamento pendente (che punta
 *     a un file non ancora esistente) è rifiutato.
 *   - La ricerca nel contenuto salta i collegamenti simbolici.
 *
 * Versione dichiarata (repo VERSION, iniettata alla build)
 *   - AGENT_VERSION qui sotto è 'dev' nel sorgente: scripts/build-exe.mjs la
 *     sostituisce con il contenuto di VERSION al momento della build, quindi
 *     l'eseguibile pubblicato dichiara da sé quale tag contiene. La versione
 *     esce all'avvio, nel body del poll (campo `version`) e con --version;
 *     --self-test verifica senza rete i punti che una build sbagliata
 *     romperebbe in silenzio (normalizzazione baseUrl, allowedDirs).
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const readline = require('readline');

// Versione dell'agente. Sostituita alla build con il contenuto di VERSION:
// vedi scripts/build-exe.mjs. 'dev' significa "eseguito dal sorgente".
const AGENT_VERSION = 'dev';

// ─── Non uscire mai in silenzio ────────────────────────────────────────────
// Lanciato a doppio click su Windows, in caso di errore la console si apre
// e chiude nell'istante di un fotogramma: l'utente non fa in tempo a
// leggere nulla. Se stdin è un terminale interattivo (TTY) aspettiamo un
// INVIO prima di chiudere; se invece stdin è una pipe/non-TTY (script,
// CI, avvio automatico) usciamo subito come prima — nessun cambiamento di
// comportamento in quei contesti.
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function fatalExit(code) {
  if (process.stdin.isTTY) {
    ask('\nPremi INVIO per chiudere...').then(() => process.exit(code));
  } else {
    process.exit(code);
  }
}

// ─── baseUrl normalization ────────────────────────────────────────────────────
// https://taxami.it risponde con un 308 verso https://www.taxami.it: nel
// salto cross-host il fetch nativo di Node scarta l'header Authorization,
// quindi ogni poll con baseUrl senza www torna 401 anche con un token
// corretto. Riscriviamo qui SOLO le varianti "nude" di taxami.it (con o
// senza slash finale, http o https) verso l'host con www: eventuali altri
// baseUrl (es. ambienti di test) restano intatti.
function normalizeBaseUrl(url) {
  if (/^https?:\/\/taxami\.it\/?$/i.test(url)) {
    return 'https://www.taxami.it';
  }
  return url;
}

// ─── First-run wizard ─────────────────────────────────────────────────────────
// Se manca il token e la console è interattiva, invece di stampare
// istruzioni tecniche e chiudere, guidiamo l'utente alla creazione della
// configurazione. Al termine riesegue loadConfig() così l'avvio prosegue
// per la strada normale (stessa validazione, stessa stampa dell'header).
async function runFirstRunWizard(configPath, baseUrl) {
  console.log('[TaxAmi Studio Agent] Nessun token configurato: avvio la procedura guidata.');
  console.log('Genera un token su taxami.it/studio/agente → "Genera token", poi incollalo qui sotto.');
  const answer = await ask('Incolla qui il token e premi INVIO: ');
  const token = answer.trim();
  if (!token) {
    console.error('[ERRORE] Nessun token inserito.');
    return fatalExit(1);
  }

  const home = os.homedir();
  const allowedDirs = ['Documents', 'Desktop', 'Downloads']
    .map((name) => path.join(home, name))
    .filter((dir) => fs.existsSync(dir));
  const label = 'PC-' + os.userInfo().username;
  const newConfig = { token, baseUrl, allowedDirs, label };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');

  console.log('');
  console.log('[OK] Configurazione creata: ' + configPath);
  console.log('     Puoi modificare le cartelle autorizzate (allowedDirs) direttamente in quel file.');
  console.log('');

  return loadConfig();
}

// ─── Config loading ───────────────────────────────────────────────────────────
async function loadConfig() {
  const configPath = path.join(os.homedir(), '.taxami-studio-agent', 'config.json');
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch (e) {
      console.error('[ERRORE] Impossibile leggere config.json: ' + e.message);
      console.error('         Verifica che il file sia JSON valido: ' + configPath);
      return fatalExit(1);
    }
  }

  const token = process.env.TAXAMI_AGENT_TOKEN || fileConfig.token;
  const baseUrl = normalizeBaseUrl(
    process.env.TAXAMI_AGENT_BASEURL || fileConfig.baseUrl || 'https://www.taxami.it'
  );

  if (!token) {
    if (process.stdin.isTTY) {
      return runFirstRunWizard(configPath, baseUrl);
    }
    console.error('[ERRORE] Token mancante. Crea il file di configurazione:');
    console.error('');
    console.error('  Percorso: ' + configPath);
    console.error('  Contenuto:');
    console.error('  {');
    console.error('    "token": "<token agente>",');
    console.error('    "baseUrl": "https://www.taxami.it",');
    console.error('    "allowedDirs": ["C:\\\\Users\\\\nome\\\\Documenti"],');
    console.error('    "label": "PC-NomeCognome"');
    console.error('  }');
    console.error('');
    console.error('  Oppure imposta la variabile d\'ambiente: TAXAMI_AGENT_TOKEN=<token>');
    return fatalExit(1);
  }

  const allowedDirs = fileConfig.allowedDirs || [];
  const workspaceDir = fileConfig.workspaceDir || undefined;
  const label = fileConfig.label || undefined;

  if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    console.error('[ERRORE] allowedDirs mancante o vuoto nel file di configurazione.');
    console.error('         Devi specificare almeno una cartella consentita.');
    console.error('         Esempio: "allowedDirs": ["C:\\\\Users\\\\nome\\\\Documenti"]');
    return fatalExit(1);
  }

  return { token, baseUrl, allowedDirs, workspaceDir, label };
}

// Config globale, valorizzata da main() dopo il caricamento/wizard. Le
// funzioni sotto la referenziano solo quando vengono effettivamente
// chiamate (mai prima che main() l'abbia impostata).
let config;

// ─── Path security ────────────────────────────────────────────────────────────
function isWithin(abs, dir) {
  return abs === dir || abs.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

// Percorso reale (collegamenti simbolici e junction risolti). Se il percorso
// non esiste ancora (scrittura, destinazione di copia) si risolve l'antenato
// esistente più vicino e si riattacca la parte mancante, che non può
// contenere collegamenti perché non esiste. Un collegamento PENDENTE (esiste,
// ma punta a qualcosa che non c'è) dà ENOENT come un percorso mancante: si
// riconosce con lstat e si rifiuta, perché scriverci crea il file dove punta.
// null se non si riesce.
async function realPathOf(target) {
  let current = path.resolve(target);
  const missing = [];
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return null;
      try {
        await fsp.lstat(current);
        return null; // esiste ma non si risolve: collegamento pendente
      } catch {
        // davvero mancante: si risale
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

// Autorizzato se il percorso sta in una delle allowedDirs sia come testo sia
// dopo aver risolto i collegamenti: un collegamento simbolico o una junction
// dentro una cartella autorizzata che punta fuori viene rifiutato.
async function isAllowed(target, allowedDirs) {
  const dirs = allowedDirs || config.allowedDirs;
  if (typeof target !== 'string' || target === '') return false;
  const abs = path.resolve(target);
  if (!dirs.some((dir) => isWithin(abs, path.resolve(dir)))) return false;

  const real = await realPathOf(abs);
  if (!real) return false;
  for (const dir of dirs) {
    let realDir;
    try {
      realDir = await fsp.realpath(path.resolve(dir));
    } catch {
      continue; // cartella autorizzata inesistente: non autorizza nulla
    }
    if (isWithin(real, realDir)) return true;
  }
  return false;
}

// ─── Auto-rename helper (never overwrite) ────────────────────────────────────
async function uniquePath(absPath) {
  if (!fs.existsSync(absPath)) return absPath;
  const ext  = path.extname(absPath);
  const base = absPath.slice(0, absPath.length - ext.length);
  for (let n = 2; n <= 50; n++) {
    const candidate = base + ' (' + n + ')' + ext;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Impossibile trovare un nome libero dopo 50 tentativi: ' + absPath);
}

// ─── Op handlers ─────────────────────────────────────────────────────────────

async function handleReadFile({ path: filePath, maxChars }) {
  if (!(await isAllowed(filePath))) {
    throw new Error('Percorso non autorizzato: ' + filePath);
  }

  const abs = path.resolve(filePath);
  const MAX = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 100000;

  // Binary heuristic: read first 8KB and check for NUL byte
  const PROBE = 8192;
  let fd;
  try {
    fd = await fsp.open(abs, 'r');
    const buf = Buffer.alloc(PROBE);
    const { bytesRead } = await fd.read(buf, 0, PROBE, 0);
    await fd.close();
    fd = null;
    const slice = buf.slice(0, bytesRead);
    if (slice.indexOf(0x00) !== -1) {
      return '[File binario, non leggibile come testo]';
    }
  } finally {
    if (fd) await fd.close().catch(() => {});
  }

  const raw = await fsp.readFile(abs, 'utf-8');
  if (raw.length > MAX) {
    return raw.slice(0, MAX) + '\n…[troncato]';
  }
  return raw;
}

async function handleListDir({ path: dirPath, recursive }) {
  if (!(await isAllowed(dirPath))) {
    throw new Error('Percorso non autorizzato: ' + dirPath);
  }

  const abs = path.resolve(dirPath);
  const lines = [];
  let capped = false;
  const CAP = 500;

  async function walk(dir, depth) {
    if (lines.length >= CAP) { capped = true; return; }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      lines.push('  [Errore lettura: ' + e.message + ']');
      return;
    }
    for (const ent of entries) {
      if (lines.length >= CAP) { capped = true; return; }
      const rel = path.relative(abs, path.join(dir, ent.name));
      lines.push(ent.isDirectory() ? rel + '/' : rel);
      if (recursive && ent.isDirectory() && depth < 3) {
        await walk(path.join(dir, ent.name), depth + 1);
      }
    }
  }

  await walk(abs, 0);

  if (capped) {
    lines.push('… [lista troncata a ' + CAP + ' elementi]');
  }

  return lines.length > 0 ? lines.join('\n') : '(cartella vuota)';
}

async function handleSearchFiles({ query, dir, searchContent }) {
  if (!(await isAllowed(dir))) {
    throw new Error('Percorso non autorizzato: ' + dir);
  }

  const abs = path.resolve(dir);
  const lowerQuery = query.toLowerCase();
  const matches = [];
  let scanned = 0;
  const MAX_SCAN = 3000;
  const MAX_MATCHES = 50;
  const MAX_CONTENT_SIZE = 200 * 1024; // 200KB

  async function walk(current, depth) {
    if (scanned >= MAX_SCAN || matches.length >= MAX_MATCHES) return;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (scanned >= MAX_SCAN || matches.length >= MAX_MATCHES) return;
      const fullPath = path.join(current, ent.name);
      // I collegamenti simbolici possono puntare fuori dalle allowedDirs: non
      // si seguono (né per la ricerca nel contenuto né per scendere).
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (depth < 4) await walk(fullPath, depth + 1);
        continue;
      }
      scanned++;
      // Match by filename
      if (ent.name.toLowerCase().includes(lowerQuery)) {
        matches.push(fullPath);
        continue;
      }
      // Match by content if requested
      if (searchContent) {
        try {
          const stat = await fsp.stat(fullPath);
          if (stat.size <= MAX_CONTENT_SIZE) {
            const content = await fsp.readFile(fullPath, 'utf-8');
            if (content.toLowerCase().includes(lowerQuery)) {
              matches.push(fullPath);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(abs, 0);

  if (matches.length === 0) {
    return 'Nessun file trovato.';
  }

  let result = matches.join('\n');
  if (matches.length >= MAX_MATCHES) {
    result += '\n… [risultati troncati a ' + MAX_MATCHES + '. Affina la ricerca.]';
  }
  if (scanned >= MAX_SCAN) {
    result += '\n[Nota: scansione interrotta a ' + MAX_SCAN + ' file]';
  }
  return result;
}

async function handleWriteFile({ path: filePath, content }) {
  if (!(await isAllowed(filePath))) {
    throw new Error('Percorso non autorizzato: ' + filePath);
  }
  if (typeof content !== 'string') {
    throw new Error('Il parametro content deve essere una stringa.');
  }
  const abs = path.resolve(filePath);
  const final = await uniquePath(abs);
  await fsp.mkdir(path.dirname(final), { recursive: true });
  await fsp.writeFile(final, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  return 'File scritto: ' + final + ' (' + bytes + ' byte)';
}

async function handleReadBinary({ path: filePath, maxBytes }) {
  if (!(await isAllowed(filePath))) {
    throw new Error('Percorso non autorizzato: ' + filePath);
  }
  const abs = path.resolve(filePath);
  const MAX_DEFAULT = 5_000_000;
  const MAX_HARD    = 8_000_000;
  const limit = (typeof maxBytes === 'number' && maxBytes > 0)
    ? Math.min(maxBytes, MAX_HARD)
    : MAX_DEFAULT;
  const stat = await fsp.stat(abs);
  if (stat.size > limit) {
    throw new Error(
      'File troppo grande (' + stat.size + ' byte, max ' + limit + ')'
    );
  }
  const buf = await fsp.readFile(abs);
  return buf.toString('base64');
}

async function handleWriteBinary({ path: filePath, contentBase64 }) {
  if (!(await isAllowed(filePath))) {
    throw new Error('Percorso non autorizzato: ' + filePath);
  }
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
    throw new Error('Il parametro contentBase64 deve essere una stringa non vuota.');
  }
  const abs = path.resolve(filePath);
  const final = await uniquePath(abs);
  await fsp.mkdir(path.dirname(final), { recursive: true });
  const buf = Buffer.from(contentBase64, 'base64');
  await fsp.writeFile(final, buf);
  return 'File scritto: ' + final + ' (' + buf.length + ' byte)';
}

async function handleFileInfo({ path: filePath }) {
  if (!(await isAllowed(filePath))) {
    throw new Error('Percorso non autorizzato: ' + filePath);
  }
  const abs = path.resolve(filePath);
  const stat = await fsp.stat(abs);
  return JSON.stringify({
    path: abs,
    isDirectory: stat.isDirectory(),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    createdAt: stat.birthtime.toISOString(),
  });
}

async function handleCopyFile({ sourcePath, destPath }) {
  if (!(await isAllowed(sourcePath))) {
    throw new Error('Percorso di origine non autorizzato: ' + sourcePath);
  }
  if (!(await isAllowed(destPath))) {
    throw new Error('Percorso di destinazione non autorizzato: ' + destPath);
  }
  const absSrc = path.resolve(sourcePath);
  const absDest = await uniquePath(path.resolve(destPath));
  await fsp.mkdir(path.dirname(absDest), { recursive: true });
  await fsp.copyFile(absSrc, absDest);
  return 'File copiato: ' + absDest;
}

async function handleMoveFile({ sourcePath, destPath }) {
  if (!(await isAllowed(sourcePath))) {
    throw new Error('Percorso di origine non autorizzato: ' + sourcePath);
  }
  if (!(await isAllowed(destPath))) {
    throw new Error('Percorso di destinazione non autorizzato: ' + destPath);
  }
  const absSrc = path.resolve(sourcePath);
  const absDest = await uniquePath(path.resolve(destPath));
  await fsp.mkdir(path.dirname(absDest), { recursive: true });
  await fsp.rename(absSrc, absDest);
  return 'File spostato: ' + absDest;
}

async function dispatchOp(op) {
  const { action, params } = op;
  switch (action) {
    case 'pc_read_file':    return { ok: true, result: await handleReadFile(params) };
    case 'pc_list_dir':     return { ok: true, result: await handleListDir(params) };
    case 'pc_search_files': return { ok: true, result: await handleSearchFiles(params) };
    case 'pc_write_file':   return { ok: true, result: await handleWriteFile(params) };
    case 'pc_read_binary':  return { ok: true, result: await handleReadBinary(params) };
    case 'pc_write_binary': return { ok: true, result: await handleWriteBinary(params) };
    case 'pc_file_info':    return { ok: true, result: await handleFileInfo(params) };
    case 'pc_copy_file':    return { ok: true, result: await handleCopyFile(params) };
    case 'pc_move_file':    return { ok: true, result: await handleMoveFile(params) };
    default:
      return { ok: false, error: 'Azione non supportata da questa versione dell\'agente.' };
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
let busy = false;

async function pollOnce() {
  if (busy) return;
  busy = true;
  try {
    const pollBody = { allowedDirs: config.allowedDirs, version: AGENT_VERSION };
    if (config.workspaceDir) pollBody.workspaceDir = config.workspaceDir;
    if (config.label)        pollBody.label = config.label;

    let pollRes;
    try {
      pollRes = await fetch(config.baseUrl + '/api/studio/agent/poll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.token,
        },
        body: JSON.stringify(pollBody),
      });
    } catch (e) {
      console.warn('[WARN] Errore di rete (poll): ' + e.message);
      return;
    }

    if (!pollRes.ok) {
      if (pollRes.status === 401) {
        console.error('[ERRORE] Token non valido o scaduto (401). Verifica la configurazione.');
        console.error('         Verifica che baseUrl sia https://www.taxami.it (con www).');
      } else {
        console.warn('[WARN] Poll risposta ' + pollRes.status);
      }
      return;
    }

    let pollData;
    try {
      pollData = await pollRes.json();
    } catch (e) {
      console.warn('[WARN] Risposta poll non è JSON valido: ' + e.message);
      return;
    }

    const { op } = pollData;
    if (!op) return; // nessun lavoro

    console.log('[OP] ' + op.id + ' → ' + op.action);

    let resultPayload;
    try {
      resultPayload = await dispatchOp(op);
    } catch (e) {
      resultPayload = { ok: false, error: e.message };
    }

    try {
      const resultRes = await fetch(
        config.baseUrl + '/api/studio/agent/ops/' + op.id + '/result',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.token,
          },
          body: JSON.stringify(resultPayload),
        }
      );
      if (!resultRes.ok) {
        console.warn('[WARN] Invio risultato risposta ' + resultRes.status);
      } else {
        console.log('[OK] ' + op.id + ' completato');
      }
    } catch (e) {
      console.warn('[WARN] Errore di rete (result): ' + e.message);
    }

  } finally {
    busy = false;
  }
}

// ─── Self-test (usato dalla CI sull'eseguibile compilato) ────────────────────
// Esercita senza rete i due punti che una build sbagliata romperebbe in
// silenzio: la normalizzazione del baseUrl e il controllo dei percorsi, incluse
// le due garanzie v3.1 (un file non ancora esistente dentro allowedDirs deve
// passare; un collegamento che punta fuori deve essere rifiutato).
async function runSelfTest() {
  const failures = [];
  const check = (name, condition) => {
    if (!condition) failures.push(name);
  };

  check('baseUrl nudo https', normalizeBaseUrl('https://taxami.it') === 'https://www.taxami.it');
  check('baseUrl nudo http con slash', normalizeBaseUrl('http://taxami.it/') === 'https://www.taxami.it');
  check('baseUrl con www intatto', normalizeBaseUrl('https://www.taxami.it') === 'https://www.taxami.it');
  check('baseUrl locale intatto', normalizeBaseUrl('http://127.0.0.1:2345') === 'http://127.0.0.1:2345');

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'taxami-agent-selftest-'));
  try {
    const allowed = path.join(root, 'allowed');
    const outside = path.join(root, 'outside');
    await fsp.mkdir(allowed, { recursive: true });
    await fsp.mkdir(outside, { recursive: true });
    await fsp.writeFile(path.join(allowed, 'ok.txt'), 'ok', 'utf8');
    await fsp.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');

    config = { allowedDirs: [allowed] };
    check('dentro allowedDirs', await isAllowed(path.join(allowed, 'ok.txt')));
    check('fuori allowedDirs', !(await isAllowed(path.join(outside, 'secret.txt'))));
    check('percorso vuoto', !(await isAllowed('')));
    check('file ancora da creare dentro', await isAllowed(path.join(allowed, 'nuovo.txt')));

    // v3.1: un collegamento dentro allowedDirs che punta fuori non autorizza.
    const link = path.join(allowed, 'link-esterno');
    let linked = false;
    try {
      await fsp.symlink(outside, link, 'junction');
      linked = true;
    } catch (e) {
      try {
        await fsp.symlink(outside, link, 'dir');
        linked = true;
      } catch (e2) {
        // Windows senza privilegi di creazione collegamenti: caso saltato.
      }
    }
    if (linked) {
      check('collegamento che esce da allowedDirs', !(await isAllowed(path.join(link, 'secret.txt'))));
    } else {
      console.log('SKIP collegamenti: questa macchina non consente di crearne (nessun privilegio)');
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }

  if (failures.length > 0) {
    console.error('SELFTEST FALLITO: ' + failures.join(', '));
    return 2;
  }
  return 0;
}

// ─── Avvio ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--version')) {
    console.log('TaxAmi Studio Agent ' + AGENT_VERSION);
    return;
  }

  if (argv.includes('--self-test')) {
    const code = await runSelfTest();
    console.log(code === 0 ? 'SELFTEST OK ' + AGENT_VERSION : 'SELFTEST KO');
    process.exitCode = code;
    return;
  }

  // Node 18+ check
  if (typeof fetch === 'undefined') {
    console.error('[ERRORE] Serve Node 18+ per usare questo agente (fetch globale mancante).');
    console.error('         Versione attuale: ' + process.version);
    console.error('         Scarica Node 18+ da: https://nodejs.org/');
    return fatalExit(1);
  }

  config = await loadConfig();
  if (!config) return; // fatalExit già in corso (TTY: in attesa di INVIO; non-TTY: già uscito)

  // Stampa config (token mascherato)
  const maskedToken = config.token.length > 8
    ? config.token.slice(0, 4) + '****' + config.token.slice(-4)
    : '****';
  console.log('[TaxAmi Studio Agent] ' + AGENT_VERSION);
  console.log('  baseUrl    : ' + config.baseUrl);
  console.log('  token      : ' + maskedToken);
  console.log('  allowedDirs: ' + config.allowedDirs.join(', '));
  if (config.workspaceDir) console.log('  workspaceDir: ' + config.workspaceDir);
  if (config.label)        console.log('  label       : ' + config.label);
  console.log('');
  console.log('Agente avviato, in ascolto...');

  // Start polling every 2000ms
  setInterval(() => {
    pollOnce().catch(e => console.warn('[WARN] Errore inatteso nel poll: ' + e.message));
  }, 2000);

  // Run immediately on start
  pollOnce().catch(e => console.warn('[WARN] Errore inatteso nel poll iniziale: ' + e.message));
}

module.exports = { isAllowed, realPathOf };

// I test caricano il modulo senza avviare l'agente.
if (process.env.TAXAMI_STUDIO_AGENT_NO_MAIN !== '1') {
  main();
}
