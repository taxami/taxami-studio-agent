# TaxAmi Studio Agent

Agente locale che collega il tuo PC all'assistente AI di **TaxAmi Studio**.

Funziona in **sola lettura** per default: legge file e fogli Excel presenti nelle cartelle che autorizzi. Le operazioni di **scrittura** (salvataggio file, modifica documenti) avvengono **solo previa conferma esplicita nella webapp** — il programma non sovrascrive mai nulla in autonomia.

---

## Download

Scarica l'eseguibile per Windows x64 (nessuna installazione richiesta):

**[TaxamiStudioAgent.exe](https://github.com/taxami/taxami-studio-agent/releases/latest/download/TaxamiStudioAgent.exe)**

Ogni eseguibile dichiara la versione che contiene:

```bat
TaxamiStudioAgent.exe --version
```

## Releases

Ogni rilascio è un tag `vX.Y.Z` su `main`, con una serie di versioni propria del repo; l'eseguibile
pubblicato è costruito dal workflow a partire da quel tag, non da una macchina. Un commit o un branch
non sono un rilascio. Regola generale: `../AGENTS.md`; procedura completa: `taxami-webapp/AGENTS.md`
(ADR-045). Passi concreti di tag, pubblicazione, verifica e rollback: `RELEASE.md`.

---

## Requisiti

- **Per l'eseguibile `.exe`**: nessuno — funziona direttamente su Windows 10/11 x64.
- **Per lo script `.js`** (alternativa per utenti avanzati): Node.js 18 o superiore.

---

## Configurazione

> **Dal v2.1.0:** se lanci l'eseguibile a doppio click e non hai ancora un file di configurazione, l'agente avvia da solo un piccolo wizard: ti chiede di incollare il token e crea `config.json` per te (con le cartelle `Documents`/`Desktop`/`Downloads` disponibili come `allowedDirs`). Non serve più creare il file a mano — puoi comunque farlo, o modificarlo dopo, seguendo lo schema sotto.

In alternativa, puoi creare il file di configurazione manualmente prima del primo avvio:

**Percorso:** `%USERPROFILE%\.taxami-studio-agent\config.json`

```json
{
  "token": "<token agente>",
  "baseUrl": "https://www.taxami.it",
  "allowedDirs": ["C:\\Users\\NomeCognome\\Documenti"],
  "label": "PC-NomeCognome"
}
```

| Campo | Descrizione |
|---|---|
| `token` | Il token personale generato su [taxami.it/studio/agente](https://taxami.it/studio/agente) |
| `baseUrl` | Lascia invariato: `https://www.taxami.it` (**con www** — vedi nota v2.2.0 sotto) |
| `allowedDirs` | Elenco delle cartelle a cui l'agente può accedere (percorsi assoluti Windows) |
| `label` | Nome identificativo del PC nella webapp (es. `PC-Studio`, `Laptop-Marco`) |

> **Dal v2.2.0:** `https://taxami.it` (senza www) reindirizza a `https://www.taxami.it`, e nel redirect Node scarta l'header di autenticazione — ogni collegamento con `baseUrl` senza www falliva con "token non valido" anche con un token corretto. L'agente ora usa `https://www.taxami.it` come default e **normalizza automaticamente** le configurazioni esistenti create senza www, quindi i file già in uso continuano a funzionare senza modifiche.

---

## Avvio

1. Fai **doppio click** su `TaxamiStudioAgent.exe`
2. Lascia la finestra del terminale aperta mentre usi l'assistente AI nella webapp
3. Quando hai finito, chiudi la finestra per disconnettere l'agente

> **Nota SmartScreen:** la prima volta Windows potrebbe mostrare un avviso di sicurezza perché l'eseguibile non è firmato con un certificato a pagamento. Clicca **"Ulteriori informazioni" → "Esegui comunque"** per procedere.

> **Dal v2.1.0:** se manca la configurazione o c'è un errore all'avvio (token assente, config non valida), la finestra **non si chiude più da sola** — resta aperta con il messaggio d'errore finché non premi INVIO, così hai il tempo di leggerlo.

---

## Privacy e sicurezza

- L'agente accede **solo alle cartelle elencate** in `allowedDirs`
- Il token è legato al tuo account TaxAmi Studio e può essere revocato in qualsiasi momento dalla webapp
- Nessun file viene trasmesso automaticamente: la lettura avviene solo su richiesta esplicita dell'assistente AI durante una sessione attiva
- Le operazioni di scrittura richiedono sempre una conferma separata nella webapp prima di essere eseguite

---

## Alternativa: esecuzione via Node.js

Se preferisci non usare l'eseguibile, puoi avviare lo script direttamente con Node 18+:

```bash
node studio-agent.js
```

Richiede lo stesso file `config.json` descritto sopra. Anche lo script accetta `--version` e
`--self-test`; la versione mostrata è `dev`, perché solo la build inietta `VERSION`.

---

## Sviluppo: come nasce l'eseguibile

L'eseguibile lo produce solo lo script di build, che inietta `VERSION` nel sorgente e impacchetta con
`@yao-pkg/pkg` su una base Node 24 (`--no-bytecode`, quindi il sorgente resta leggibile dentro l'exe):

```bash
npm ci
npm run check              # sintassi
npm test                   # guardia percorsi e collegamenti (SEC-032)
npm run build:exe        # → dist/TaxamiStudioAgent.exe + dist/SHA256SUMS.txt
npm run verify:embedded  # il sorgente dentro l'exe coincide con quello del tag?
npm run e2e              # agente vero contro un finto server, nessuna rete
npm run e2e -- --bin dist/TaxamiStudioAgent.exe   # lo stesso, sul binario (Windows)
```

In CI: `.github/workflows/ci.yml` a ogni PR, `.github/workflows/release.yml` al tag. **Nessun
eseguibile viene caricato a mano su una release.**

## Verificare una release

```bash
sha256sum -c <(gh release download vX.Y.Z -R taxami/taxami-studio-agent -p SHA256SUMS.txt -O -)
gh attestation verify TaxamiStudioAgent.exe --repo taxami/taxami-studio-agent
git show vX.Y.Z:studio-agent.js | grep "const AGENT_VERSION = 'X.Y.Z';"
```

L'attestazione dice da quale workflow, repo e commit è uscito il file; il terzo comando controlla che
il tag contenga la versione che l'eseguibile dichiara.

---

*Prodotto da [TaxAmi](https://taxami.it) — assistente AI per PMI e professionisti italiani.*
