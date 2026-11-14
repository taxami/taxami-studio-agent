#!/usr/bin/env node
/**
 * build-exe.mjs — l'unico modo in cui nasce TaxamiStudioAgent.exe.
 *
 * Perché esiste: fino a v2.2.0 l'eseguibile veniva compilato a mano su un PC e
 * allegato alla release, quindi il tag identificava il sorgente ma non il
 * binario pubblicato. Qui la build parte dal commit, inietta VERSION nel
 * sorgente e lascia un artefatto che chiunque può confrontare con il tag:
 * il file incorporato è testo (--no-bytecode), non bytecode V8.
 *
 *   node scripts/build-exe.mjs [--out dist/TaxamiStudioAgent.exe] [--target node24-win-x64]
 *
 * Accanto all'exe esce dist/studio-agent.js (lo stesso sorgente, versione
 * iniettata) e SHA256SUMS.txt con l'impronta di entrambi.
 *
 * Con GITHUB_REF_NAME (tag push) la versione del tag deve coincidere con
 * VERSION, altrimenti la build si ferma prima di produrre qualcosa.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error('[build-exe] ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: path.join(ROOT, 'dist', 'TaxamiStudioAgent.exe'), target: 'node24-win-x64' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--target') args.target = argv[++i];
    else fail('argomento sconosciuto: ' + argv[i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// ─── Versione: VERSION è l'unica fonte ───────────────────────────────────────
const version = readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail('VERSION non è una versione semantica X.Y.Z: ' + JSON.stringify(version));
}

const refName = process.env.GITHUB_REF_NAME || '';
if (refName.startsWith('v') && refName !== 'v' + version) {
  fail('il tag ' + refName + ' non corrisponde a VERSION ' + version);
}

// ─── Sorgente con la versione iniettata ──────────────────────────────────────
const sourcePath = path.join(ROOT, 'studio-agent.js');
const source = readFileSync(sourcePath, 'utf8');
const placeholder = "const AGENT_VERSION = 'dev';";
const occurrences = source.split(placeholder).length - 1;
if (occurrences !== 1) {
  fail(
    'atteso esattamente un ' + placeholder + ' in studio-agent.js, trovati ' + occurrences
  );
}

const buildDir = path.join(ROOT, '.build');
mkdirSync(buildDir, { recursive: true });
const builtScript = path.join(buildDir, 'studio-agent.built.js');
writeFileSync(builtScript, source.replace(placeholder, "const AGENT_VERSION = '" + version + "';"), 'utf8');

// La sintassi si controlla sul file che verrà impacchettato, non sull'originale.
execFileSync(process.execPath, ['--check', builtScript], { stdio: 'inherit' });

// ─── pkg ─────────────────────────────────────────────────────────────────────
const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
mkdirSync(path.dirname(args.out), { recursive: true });

console.log(
  '[build-exe] versione ' + version + ' → ' + args.target + ' → ' + path.relative(ROOT, args.out)
);

execFileSync(
  process.execPath,
  [
    pkgBin,
    builtScript,
    '--target', args.target,
    // Testo, non bytecode: il sorgente incorporato resta estraibile e
    // confrontabile con il tag (scripts/verify-embedded.mjs).
    '--no-bytecode',
    '--public',
    '--public-packages', '*',
    '--output', args.out,
  ],
  { stdio: 'inherit', cwd: ROOT }
);

if (!existsSync(args.out)) fail('pkg non ha prodotto ' + args.out);

const { size } = statSync(args.out);
if (size < 10 * 1024 * 1024) {
  fail('eseguibile sospettosamente piccolo (' + size + ' byte): manca la base Node?');
}

// ─── Script Node pubblicato accanto all'exe ──────────────────────────────────
// Lo stesso sorgente impacchettato (versione già iniettata) esce anche come
// file a sé: chi usa Node scarica dalla release lo script del tag, che si
// dichiara con la stessa versione dell'exe invece di 'dev'. La webapp lo
// linka da /studio/agente; il suo SHA-256 sta nello stesso SHA256SUMS.txt.
const outDir = path.dirname(args.out);
const scriptOut = path.join(outDir, 'studio-agent.js');
writeFileSync(scriptOut, readFileSync(builtScript));

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const artifacts = [args.out, scriptOut].map((file) => ({ file, sha256: digest(file) }));
const checksumFile = path.join(outDir, 'SHA256SUMS.txt');
writeFileSync(
  checksumFile,
  artifacts.map(({ file, sha256 }) => sha256 + '  ' + path.basename(file) + '\n').join(''),
  'utf8'
);

console.log('[build-exe] ' + path.relative(ROOT, args.out) + ' ' + size + ' byte');
for (const { file, sha256 } of artifacts) {
  console.log('[build-exe] sha256 ' + sha256 + '  ' + path.relative(ROOT, file));
}
console.log('[build-exe] checksum in ' + path.relative(ROOT, checksumFile));
