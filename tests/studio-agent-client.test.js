// ---------------------------------------------------------------------------
// Agente desktop di Studio (studio-agent.js), controllo dei percorsi (SEC-032):
// un collegamento simbolico o una junction DENTRO una cartella autorizzata che
// punta FUORI non deve far leggere né scrivere fuori. Usa cartelle temporanee
// vere: su Windows le junction non richiedono privilegi, i collegamenti
// simbolici a file sì (quel caso si salta se il sistema li rifiuta).
//
// Portato da taxami-webapp `tests/unit/studio-agent-client.test.ts` (SEC-032,
// PR #527) quando il client è diventato una sola copia nel suo repository:
// gli stessi casi, stesso semaforo, niente dipendenze di test (node:test).
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

function link(target, at) {
  // 'junction' è ignorato fuori da Windows, dove diventa un symlink a cartella.
  fs.symlinkSync(target, at, 'junction');
}

before(() => {
  process.env.TAXAMI_STUDIO_AGENT_NO_MAIN = '1';
  agent = require('../studio-agent.js');

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'taxami-agent-'));
  allowed = path.join(root, 'clienti');
  allowed2 = path.join(root, 'archivio');
  outside = path.join(root, 'riservato');
  for (const d of [allowed, allowed2, outside]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(allowed, 'fattura.txt'), 'ok');
  fs.writeFileSync(path.join(outside, 'segreto.txt'), 'fuori');
  fs.mkdirSync(path.join(root, 'clienti2'));
  link(outside, path.join(allowed, 'ponte'));
  link(allowed2, path.join(allowed, 'verso-archivio'));
});

after(() => {
  delete process.env.TAXAMI_STUDIO_AGENT_NO_MAIN;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isAllowed: percorsi testuali (comportamento invariato)', () => {
  it('file e cartella dentro una cartella autorizzata', async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'fattura.txt'), [allowed]), true);
    assert.equal(await agent.isAllowed(allowed, [allowed]), true);
  });

  it('file ancora da creare, anche in sottocartelle inesistenti', async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'nuova', 'sotto', 'bozza.txt'), [allowed]), true);
  });

  it('fuori, con risalita .. e con il prefisso di nome ingannevole', async () => {
    assert.equal(await agent.isAllowed(path.join(outside, 'segreto.txt'), [allowed]), false);
    assert.equal(await agent.isAllowed(path.join(allowed, '..', 'riservato', 'segreto.txt'), [allowed]), false);
    assert.equal(await agent.isAllowed(path.join(root, 'clienti2', 'x.txt'), [allowed]), false);
  });

  it('percorso vuoto o non stringa', async () => {
    assert.equal(await agent.isAllowed('', [allowed]), false);
    assert.equal(await agent.isAllowed(undefined, [allowed]), false);
  });
});

describe('isAllowed: collegamenti che escono (SEC-032)', () => {
  it('lettura di un file attraverso una junction che punta fuori: rifiutata', async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'ponte', 'segreto.txt'), [allowed]), false);
  });

  it('elenco della junction stessa: rifiutato', async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'ponte'), [allowed]), false);
  });

  it('scrittura di un file NUOVO attraverso la junction: rifiutata', async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'ponte', 'nuovo', 'payload.txt'), [allowed]), false);
  });

  it('collegamento simbolico a un file fuori: rifiutato', async (t) => {
    const at = path.join(allowed, 'scorciatoia.txt');
    try {
      fs.symlinkSync(path.join(outside, 'segreto.txt'), at, 'file');
    } catch (e) {
      if (e.code === 'EPERM') {
        t.skip('questo sistema non consente collegamenti simbolici a file');
        return;
      }
      throw e;
    }
    assert.equal(await agent.isAllowed(at, [allowed]), false);
  });

  it('collegamento PENDENTE verso fuori (scrivere lì creerebbe il file fuori): rifiutato', async () => {
    const at = path.join(allowed, 'pendente');
    link(path.join(outside, 'non-esiste-ancora'), at);
    assert.equal(await agent.isAllowed(at, [allowed]), false);
    assert.equal(await agent.isAllowed(path.join(at, 'x.txt'), [allowed]), false);
  });

  it('collegamento simbolico PENDENTE a un file fuori: rifiutato', async (t) => {
    const at = path.join(allowed, 'bozza-link.txt');
    try {
      fs.symlinkSync(path.join(outside, 'nuovo.txt'), at, 'file');
    } catch (e) {
      if (e.code === 'EPERM') {
        t.skip('questo sistema non consente collegamenti simbolici a file');
        return;
      }
      throw e;
    }
    assert.equal(await agent.isAllowed(at, [allowed]), false);
  });

  it("junction verso un'ALTRA cartella autorizzata: ammessa", async () => {
    assert.equal(await agent.isAllowed(path.join(allowed, 'verso-archivio', 'x.txt'), [allowed, allowed2]), true);
    assert.equal(await agent.isAllowed(path.join(allowed, 'verso-archivio', 'x.txt'), [allowed]), false);
  });

  it('cartella autorizzata che è essa stessa una junction (es. cartella reindirizzata): ammessa', async () => {
    const alias = path.join(root, 'alias-clienti');
    link(allowed, alias);
    assert.equal(await agent.isAllowed(path.join(alias, 'fattura.txt'), [alias]), true);
    assert.equal(await agent.isAllowed(path.join(alias, 'ponte', 'segreto.txt'), [alias]), false);
  });
});

describe('realPathOf', () => {
  it('risolve la junction e riattacca la parte che non esiste', async () => {
    const real = await agent.realPathOf(path.join(allowed, 'ponte', 'a', 'b.txt'));
    assert.equal(real, path.join(fs.realpathSync.native(outside), 'a', 'b.txt'));
  });
});
