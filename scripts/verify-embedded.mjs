#!/usr/bin/env node
/**
 * verify-embedded.mjs — l'eseguibile contiene il sorgente che il tag dichiara?
 *
 * Con `--no-bytecode` (vedi build-exe.mjs) pkg incorpora il file così com'è,
 * quindi la risposta si ottiene cercando i byte esatti del sorgente dentro
 * l'exe: nessun confronto euristico, nessuna fiducia nel log di build.
 * Con il vecchio `vercel/pkg` questo controllo era impossibile: il payload era
 * bytecode V8.
 *
 *   node scripts/verify-embedded.mjs [--exe dist/TaxamiStudioAgent.exe] [--source .build/studio-agent.built.js]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error('[verify-embedded] ' + message);
  process.exit(1);
}

const args = { exe: path.join(ROOT, 'dist', 'TaxamiStudioAgent.exe'), source: path.join(ROOT, '.build', 'studio-agent.built.js') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--exe') args.exe = path.resolve(argv[++i]);
  else if (argv[i] === '--source') args.source = path.resolve(argv[++i]);
  else fail('argomento sconosciuto: ' + argv[i]);
}

if (!existsSync(args.exe)) fail('eseguibile non trovato: ' + args.exe + ' (prima: npm run build:exe)');
if (!existsSync(args.source)) fail('sorgente di build non trovato: ' + args.source);

const exe = readFileSync(args.exe);
const source = readFileSync(args.source);

// Il file è incorporato byte per byte; su Windows pkg può però normalizzare i
// fine riga, quindi si accetta anche la variante CRLF, dichiarandolo.
const variants = [
  { name: 'byte identici', buffer: source },
  { name: 'LF→CRLF', buffer: Buffer.from(source.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8') },
];

for (const variant of variants) {
  if (exe.includes(variant.buffer)) {
    console.log(
      '[verify-embedded] OK: il sorgente incorporato coincide con ' +
        path.relative(ROOT, args.source) + ' (' + source.length + ' byte, ' + variant.name + ')'
    );
    process.exit(0);
  }
}

fail(
  'il sorgente incorporato NON coincide con ' + path.relative(ROOT, args.source) +
    ': l\'eseguibile non è stato costruito da questo albero'
);
