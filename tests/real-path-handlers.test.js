// ---------------------------------------------------------------------------
// SEC-032 (d): gli handler lavorano sul percorso REALE verificato, le scritture
// creano solo file nuovi (wx / COPYFILE_EXCL) e le letture non seguono un
// collegamento all'ultimo componente dove il sistema lo permette (O_NOFOLLOW).
// Cartelle temporanee vere; i casi con collegamenti si saltano se il sistema
// non li consente.
// ---------------------------------------------------------------------------
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let agent;
let root;
let allowed;
let allowed2;
let outside;
let canLink = true;

function link(target, at, type) {
  try {
    fs.symlinkSync(target, at, type || 'junction');
    return true;
  } catch {
    canLink = false;
    return false;
  }
}

before(() => {
  process.env.TAXAMI_STUDIO_AGENT_NO_MAIN = '1';
  agent = require('../studio-agent.js');
  // realpathSync.native, come fsp.realpath nell'agente: su Windows espande
  // anche i nomi brevi 8.3 della cartella temporanea (RUNNER~1).
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'taxami-agent-real-')));
  allowed = path.join(root, 'clienti');
  allowed2 = path.join(root, 'archivio');
  outside = path.join(root, 'riservato');
  for (const d of [allowed, allowed2, outside]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(allowed, 'nota.txt'), 'dentro');
  fs.writeFileSync(path.join(allowed2, 'storico.txt'), 'archivio');
  fs.writeFileSync(path.join(outside, 'segreto.txt'), 'fuori');
  link(allowed2, path.join(allowed, 'verso-archivio'));
  agent._setConfigForTests({ allowedDirs: [allowed, allowed2] });
});

after(() => {
  delete process.env.TAXAMI_STUDIO_AGENT_NO_MAIN;
  fs.rmSync(root, { recursive: true, force: true });
});

async function run(action, params) {
  return agent.dispatchOp({ id: 't', action, params });
}

describe('handler sul percorso reale', () => {
  it('allowedRealPath: percorso reale dentro, null fuori o vuoto', async () => {
    assert.equal(await agent.allowedRealPath(path.join(allowed, 'nota.txt')), path.join(allowed, 'nota.txt'));
    assert.equal(await agent.allowedRealPath(path.join(outside, 'segreto.txt')), null);
    assert.equal(await agent.allowedRealPath(''), null);
  });

  it('collegamento verso un\'altra cartella autorizzata: ammesso, e file_info riporta il percorso reale', async (t) => {
    if (!fs.existsSync(path.join(allowed, 'verso-archivio'))) return t.skip('collegamenti non consentiti');
    const viaLink = path.join(allowed, 'verso-archivio', 'storico.txt');
    const r = await run('pc_read_file', { path: viaLink });
    assert.equal(r.ok, true);
    assert.equal(r.result, 'archivio');
    const info = JSON.parse((await run('pc_file_info', { path: viaLink })).result);
    assert.equal(info.path, path.join(allowed2, 'storico.txt'));
  });

  it('le operazioni ordinarie funzionano come prima (lettura, scrittura, binario, lista, ricerca, copia, spostamento)', async () => {
    const w = await run('pc_write_file', { path: path.join(allowed, 'nuova.txt'), content: 'ciao' });
    assert.equal(w.ok, true);
    assert.equal(fs.readFileSync(path.join(allowed, 'nuova.txt'), 'utf-8'), 'ciao');

    const w2 = await run('pc_write_file', { path: path.join(allowed, 'nuova.txt'), content: 'bis' });
    assert.match(w2.result, /nuova \(2\)\.txt/, 'mai sovrascrivere: nome nuovo');

    const b = await run('pc_write_binary', { path: path.join(allowed, 'dati.bin'), contentBase64: Buffer.from([1, 2, 3]).toString('base64') });
    assert.equal(b.ok, true);
    assert.equal((await run('pc_read_binary', { path: path.join(allowed, 'dati.bin') })).result, Buffer.from([1, 2, 3]).toString('base64'));

    assert.match((await run('pc_list_dir', { path: allowed })).result, /nota\.txt/);
    assert.match((await run('pc_search_files', { query: 'nota', dir: allowed })).result, /nota\.txt/);

    const c = await run('pc_copy_file', { sourcePath: path.join(allowed, 'nota.txt'), destPath: path.join(allowed2, 'copia.txt') });
    assert.equal(c.ok, true);
    const c2 = await run('pc_copy_file', { sourcePath: path.join(allowed, 'nota.txt'), destPath: path.join(allowed2, 'copia.txt') });
    assert.match(c2.result, /copia \(2\)\.txt/);

    const m = await run('pc_move_file', { sourcePath: path.join(allowed2, 'copia (2).txt'), destPath: path.join(allowed, 'spostata.txt') });
    assert.equal(m.ok, true);
    assert.equal(fs.existsSync(path.join(allowed, 'spostata.txt')), true);
  });

  it('fuori dalle cartelle autorizzate: rifiutato come prima', async () => {
    // dispatchOp lancia; è il poll a trasformare l'errore in { ok: false }.
    await assert.rejects(run('pc_read_file', { path: path.join(outside, 'segreto.txt') }), /non autorizzato/);
    await assert.rejects(
      run('pc_write_file', { path: path.join(outside, 'nuovo.txt'), content: 'x' }),
      /non autorizzato/
    );
    assert.equal(fs.existsSync(path.join(outside, 'nuovo.txt')), false);
  });
});

describe('finestra fra controllo e uso', () => {
  it('scrittura: se al nome scelto compare un collegamento, fallisce e non tocca il file esterno', async (t) => {
    const target = path.join(allowed, 'comparso.txt');
    if (!link(path.join(outside, 'segreto.txt'), target, 'file')) return t.skip('collegamenti a file non consentiti');
    await assert.rejects(agent.writeNewFile(target, 'sovrascritto', 'utf-8'), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(outside, 'segreto.txt'), 'utf-8'), 'fuori');
  });

  it('lettura: un collegamento all\'ultimo componente non viene seguito (Linux, macOS)', async (t) => {
    if (!fs.constants.O_NOFOLLOW) return t.skip('O_NOFOLLOW non disponibile su questo sistema');
    const target = path.join(allowed, 'scambiato.txt');
    if (!link(path.join(outside, 'segreto.txt'), target, 'file')) return t.skip('collegamenti a file non consentiti');
    await assert.rejects(agent.readFileNoFollow(target, 'utf-8'), /ELOOP|EMLINK/);
  });
});
