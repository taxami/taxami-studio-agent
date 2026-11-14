# taxami-studio-agent — note per gli agenti

Regole del workspace (release, sola lettura su Vercel e Hetzner, terminologia): `../AGENTS.md`, che non
è versionato e vive solo in questo workspace. Uso del prodotto: `README.md`; tag, pubblicazione
dell'eseguibile e rollback: `RELEASE.md`; versione corrente: `VERSION`.

## Terminologia tecnica

**I termini tecnici restano in inglese, in qualunque lingua si scriva.** In un testo italiano un termine
tecnico non si traduce, non si parafrasa e non si glossa: `release`, `merge`, `commit`, `branch`,
`tag`, `deploy`, `endpoint`, `payload`, `webhook`, `prompt`, `token`, `embedding`, `chunk`, `cache`,
`rollback`, `staging`, `preview` restano come li scrivono il codice e gli strumenti, dentro la frase
italiana come qualunque altra parola. La prosa intorno resta in italiano: questa regola fissa la
terminologia, non impone di scrivere tutto in inglese. Un termine mantiene la forma che usa il codice,
mai un sinonimo inglese nuovo. Niente calchi e niente doppio nome: mai "rilascio" per `release`,
"distribuzione" per `deploy`, "incorporamento" per `embedding`, "gettone" per `token`, e mai
`release (rilascio)`. Vale per email, documenti, report, testi di PR e commit, commenti, changelog e
chat, per ogni agente e ogni sessione. Il testo esistente resta com'è finché qualcuno non lo tocca;
sulle righe che riscrivi, applica questa regola.
