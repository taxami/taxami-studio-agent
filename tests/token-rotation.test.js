// ---------------------------------------------------------------------------
// Rotazione del token (SEC-032 c): createTokenState in studio-agent.js.
// Contratto del server: POST /api/studio/agent/token/rotate (taxami-webapp).
// Nessuna rete: fetch, orologio e log sono finti; config.json vive in una
// cartella temporanea.
// ---------------------------------------------------------------------------
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GIORNO = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-14T12:00:00Z');
const VECCHIO = 'token-corrente-0123456789abcdef';
const NUOVO = 'token-nuovo-fedcba9876543210ab';

let agent;
let root;

before(() => {
  process.env.TAXAMI_STUDIO_AGENT_NO_MAIN = '1';
  agent = require('../studio-agent.js');
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'taxami-agent-rot-'));
});

after(() => {
  delete process.env.TAXAMI_STUDIO_AGENT_NO_MAIN;
  fs.rmSync(root, { recursive: true, force: true });
});

let n = 0;
function setup(fileExtra = {}, cfgExtra = {}) {
  n += 1;
  const dir = path.join(root, 'caso-' + n);
  fs.mkdirSync(dir);
  const configPath = path.join(dir, 'config.json');
  const file = {
    token: VECCHIO,
    baseUrl: 'https://www.taxami.it',
    allowedDirs: ['C:/Clienti'],
    label: 'PC-Test',
    ...fileExtra,
  };
  fs.writeFileSync(configPath, JSON.stringify(file, null, 2));
  const cfg = { ...file, configPath, tokenFromEnv: false, ...cfgExtra };
  const clock = { t: T0 };
  const calls = [];
  let reply = { ok: true, status: 200, json: async () => ({ token: NUOVO, issuedAt: new Date(T0).toISOString() }) };
  const io = {
    now: () => clock.t,
    log: () => {},
    warn: () => {},
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const state = agent.createTokenState(cfg, io);
  return {
    cfg,
    clock,
    calls,
    state,
    configPath,
    setReply: (r) => { reply = r; },
    read: () => JSON.parse(fs.readFileSync(configPath, 'utf-8')),
  };
}

describe('quando ruotare', () => {
  it('età ignota (token generato a mano): da ruotare', () => {
    const t = setup();
    assert.equal(t.state.rotationDue(), true);
  });

  it('token di 10 giorni: no; di 31 giorni: sì', () => {
    const t = setup({ tokenIssuedAt: new Date(T0 - 10 * GIORNO).toISOString() });
    assert.equal(t.state.rotationDue(), false);
    t.clock.t = T0 + 21 * GIORNO;
    assert.equal(t.state.rotationDue(), true);
  });

  it('token da TAXAMI_AGENT_TOKEN: mai (non si può salvare il nuovo)', () => {
    const t = setup({}, { tokenFromEnv: true });
    assert.equal(t.state.rotationDue(), false);
  });

  it('con un pending già in corso: no', () => {
    const t = setup({ pendingToken: NUOVO, pendingIssuedAt: new Date(T0).toISOString() });
    assert.equal(t.state.rotationDue(), false);
  });
});

describe('rotazione riuscita', () => {
  it('chiama rotate col token corrente, salva il pending accanto al corrente, poi lo usa', async () => {
    const t = setup();
    assert.equal(await t.state.maybeRotate(), true);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, 'https://www.taxami.it/api/studio/agent/token/rotate');
    assert.equal(t.calls[0].init.method, 'POST');
    assert.equal(t.calls[0].init.headers.Authorization, 'Bearer ' + VECCHIO);

    const file = t.read();
    assert.equal(file.token, VECCHIO, 'il corrente resta nel file finché il nuovo non è confermato');
    assert.equal(file.pendingToken, NUOVO);
    assert.deepEqual(file.allowedDirs, ['C:/Clienti'], 'le altre chiavi restano');
    assert.equal(file.label, 'PC-Test');

    assert.deepEqual(t.state.forPoll(), { token: NUOVO, pending: true });
  });

  it('poll riuscito col pending: diventa il token nel file, con la data di emissione', async () => {
    const t = setup();
    await t.state.maybeRotate();
    const used = t.state.forPoll();
    t.state.onPollOk(used);

    const file = t.read();
    assert.equal(file.token, NUOVO);
    assert.equal(file.tokenIssuedAt, new Date(T0).toISOString());
    assert.equal('pendingToken' in file, false);
    assert.equal('pendingIssuedAt' in file, false);
    assert.equal(t.cfg.token, NUOVO, 'anche in memoria: il risultato delle op usa il token promosso');
    assert.deepEqual(t.state.forPoll(), { token: NUOVO, pending: false });
    assert.equal(t.state.rotationDue(), false);
  });

  if (process.platform !== 'win32') {
    it('config.json scritto con permessi 0600', async () => {
      const t = setup();
      await t.state.maybeRotate();
      assert.equal(fs.statSync(t.configPath).mode & 0o777, 0o600);
    });
  }
});

describe('rotazione non riuscita: il token corrente resta in uso', () => {
  it('401 col pending: pending scartato (memoria e file), si torna al corrente', async () => {
    const t = setup();
    await t.state.maybeRotate();
    const used = t.state.forPoll();
    t.state.onPoll401(used);
    assert.deepEqual(t.state.forPoll(), { token: VECCHIO, pending: false });
    assert.equal('pendingToken' in t.read(), false);
    assert.equal(t.read().token, VECCHIO);
  });

  it('pending non confermato entro 55 minuti: scartato', async () => {
    const t = setup();
    await t.state.maybeRotate();
    t.clock.t = T0 + 56 * 60 * 1000;
    assert.deepEqual(t.state.forPoll(), { token: VECCHIO, pending: false });
    assert.equal('pendingToken' in t.read(), false);
  });

  it('429 (rotazione troppo ravvicinata) o 409: nessun pending, file intatto', async () => {
    for (const status of [429, 409, 500]) {
      const t = setup();
      t.setReply({ ok: false, status, json: async () => ({}) });
      assert.equal(await t.state.maybeRotate(), false);
      assert.equal('pendingToken' in t.read(), false);
      assert.deepEqual(t.state.forPoll(), { token: VECCHIO, pending: false });
    }
  });

  it('errore di rete o risposta senza token: nessun pending', async () => {
    const t = setup();
    t.setReply(new Error('offline'));
    assert.equal(await t.state.maybeRotate(), false);
    const u = setup();
    u.setReply({ ok: true, status: 200, json: async () => ({ token: 'corto' }) });
    assert.equal(await u.state.maybeRotate(), false);
    assert.equal('pendingToken' in u.read(), false);
  });

  it('config.json non salvabile: il token nuovo NON si usa', async () => {
    const t = setup();
    t.cfg.configPath = path.join(root, 'cartella-che-non-esiste', 'config.json');
    assert.equal(await t.state.maybeRotate(), false);
    assert.deepEqual(t.state.forPoll(), { token: VECCHIO, pending: false });
  });
});

describe('ritmo dei controlli', () => {
  let t;
  beforeEach(() => {
    t = setup();
    t.setReply({ ok: false, status: 429, json: async () => ({}) });
  });

  it('al più un tentativo ogni 6 ore', async () => {
    await t.state.maybeRotate();
    t.clock.t = T0 + 5 * 60 * 60 * 1000;
    await t.state.maybeRotate();
    assert.equal(t.calls.length, 1);
    t.clock.t = T0 + 6 * 60 * 60 * 1000 + 1;
    await t.state.maybeRotate();
    assert.equal(t.calls.length, 2);
  });

  it('token recente: nessuna chiamata a rotate', async () => {
    const r = setup({ tokenIssuedAt: new Date(T0 - GIORNO).toISOString() });
    assert.equal(await r.state.maybeRotate(), false);
    assert.equal(r.calls.length, 0);
  });
});

describe('riavvio a metà rotazione', () => {
  it('file con pendingToken (salvataggio della promozione mancato): si usa il pending e lo si promuove', () => {
    const t = setup({ pendingToken: NUOVO, pendingIssuedAt: new Date(T0 - 60 * 1000).toISOString() });
    const used = t.state.forPoll();
    assert.deepEqual(used, { token: NUOVO, pending: true });
    t.state.onPollOk(used);
    assert.equal(t.read().token, NUOVO);
    assert.equal('pendingToken' in t.read(), false);
  });
});
