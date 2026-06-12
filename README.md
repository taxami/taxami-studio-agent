# TaxAmi Studio Agent

Agente locale che collega il tuo PC all'assistente AI di **TaxAmi Studio**.

Funziona in **sola lettura** per default: legge file e fogli Excel presenti nelle cartelle che autorizzi. Le operazioni di **scrittura** (salvataggio file, modifica documenti) avvengono **solo previa conferma esplicita nella webapp** — il programma non sovrascrive mai nulla in autonomia.

---

## Download

Scarica l'eseguibile per Windows x64 (nessuna installazione richiesta):

**[TaxamiStudioAgent.exe](https://github.com/taxami-dev/taxami-studio-agent/releases/latest/download/TaxamiStudioAgent.exe)**

---

## Requisiti

- **Per l'eseguibile `.exe`**: nessuno — funziona direttamente su Windows 10/11 x64.
- **Per lo script `.js`** (alternativa per utenti avanzati): Node.js 18 o superiore.

---

## Configurazione

Prima del primo avvio, crea il file di configurazione:

**Percorso:** `%USERPROFILE%\.taxami-studio-agent\config.json`

```json
{
  "token": "<token agente>",
  "baseUrl": "https://taxami.it",
  "allowedDirs": ["C:\\Users\\NomeCognome\\Documenti"],
  "label": "PC-NomeCognome"
}
```

| Campo | Descrizione |
|---|---|
| `token` | Il token personale generato su [taxami.it/studio/agente](https://taxami.it/studio/agente) |
| `baseUrl` | Lascia invariato: `https://taxami.it` |
| `allowedDirs` | Elenco delle cartelle a cui l'agente può accedere (percorsi assoluti Windows) |
| `label` | Nome identificativo del PC nella webapp (es. `PC-Studio`, `Laptop-Marco`) |

---

## Avvio

1. Fai **doppio click** su `TaxamiStudioAgent.exe`
2. Lascia la finestra del terminale aperta mentre usi l'assistente AI nella webapp
3. Quando hai finito, chiudi la finestra per disconnettere l'agente

> **Nota SmartScreen:** la prima volta Windows potrebbe mostrare un avviso di sicurezza perché l'eseguibile non è firmato con un certificato a pagamento. Clicca **"Ulteriori informazioni" → "Esegui comunque"** per procedere.

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

Richiede lo stesso file `config.json` descritto sopra.

---

*Prodotto da [TaxAmi](https://taxami.it) — assistente AI per PMI e professionisti italiani.*
