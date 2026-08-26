# Contentix v1 — Refactor-Plan: index.js in lib/-Module extrahieren

> **Methodik:** Manuell nach dem Abbruch des Refactorbot-Runs. Gelesen wurde `index.js`
> ~900 Zeilen via Trajectory (DB-Setup, MCP-Client, Refresh-Pipeline, Routes).
> Ziel: Schicht-Trennung ohne Verhaltensänderung.

## 1. Befund-Zusammenfassung

`index.js` ist 1516 Zeilen mit 4 vermischten Verantwortlichkeiten:
DB-Lifecycle (sql.js + atomic write), vidIQ-MCP-Client + Cache, Background-Refresh-Pipeline
(6 Schritte mit Progress-Tracking), Express-Routes (~32 Endpunkte). Drei Modul-Extraktionen
sind sicher; die kritische Frage ist die Migrations-Reihenfolge (DB zuerst oder Routes zuerst?).

**Empfehlung:** **Inkrementell, DB zuerst**, weil das die geringste Verhaltensänderung
mitbringt und sofort Tests ermöglicht.

## 2. Modul-Schnittstellen

### 2.1 `lib/db.js` — sql.js-Lifecycle + atomic write

**Public API:**
```js
module.exports = {
  init,           // async () → lädt/erstellt DB + Migrationen
  run,            // (sql, ...params) → execute single statement
  get,            // (sql, ...params) → erste Row oder null
  getAll,         // (sql, ...params) → Array of rows
  save,           // async () → atomic write (temp + rename + .bak)
  getDB,          // () → sql.js Database-Instanz (für Tests + Special-Cases)
  applyUpdate,    // (table, id, fields, allowedColumns, preEncode?) → updated row oder null
};
```

**Dependencies:** `sql.js`, `fs`, `path`, `dotenv`
**LOC-Schätzung:** ~180 Zeilen raus aus `index.js` (Zeilen ~50-180 + ~520-540 für `applyUpdate`)
**Was bleibt in `index.js`:** Nur der Aufruf `await init()` + Re-Exports für Routes.

**Interne Konstanten:** `SCRIPT_COLUMNS`, `VIDEO_COLUMNS`, `JSON_ENCODE_COLUMNS` —
sind eigentlich `applyUpdate`-Helper, gehören in `lib/db.js`.

### 2.2 `lib/vidiq.js` — MCP-Client + Cache + Watchtime

**Public API:**
```js
module.exports = {
  // MCP-Client (low-level)
  makeCmd,         // (apiKey) → (id, name, args) → curl-Cmd-String
  parseResponse,   // (output) → parsed object oder null
  callTool,        // (name, args, timeoutMs?) → parsed object oder null
  init,            // () → MCP initialize handshake

  // Cache + Auto-Match
  getCachedStats,  // (channelId) → cached stats oder null
  saveCachedStats, // (channelId, blob) → save merged cache
  autoMatch,       // (cardId, youtubeUrl, needsTitle, needsThumb) → void
  isValidBalance,  // (obj) → bool (verhindert cache-clobber)

  // Watchtime
  getCachedWatchtime,    // (channelId) → {minutes, avgViewPct, fetchedAt, fresh}
  saveWatchtime,         // (channelId, minutes, avgViewPct) → void
  fetchWatchtimeFromVidiq, // (channelId) → {minutes, avgViewPct}

  // Channel-ID-Constant
  CHANNEL_ID: 'UC-YmLEIgdESaoVN3ZKNT_QA',
};
```

**Dependencies:** `execSync` (child_process), `db.run/getAll/save` aus `lib/db.js`
**LOC-Schätzung:** ~480 Zeilen raus (Zeilen ~649-1126, ohne die `/api/vidiq/*`-Routes)
**Risiko:** `execSync` mit `timeout: 15000` — bei Refactor nicht versehentlich auf
`spawn` oder `exec` umstellen, das ändert Error-Handling.

### 2.3 `lib/research.js` — OpenClaw-Spawn-Logik

**Public API:**
```js
module.exports = {
  startJob,       // (videoId, agentId, brief?) → {jobId, status}
  getJob,         // (jobId) → {status, progress_message, result?, error?}
  cancelJob,      // (jobId) → boolean
  listJobs,       // ({videoId?, status?}) → Array
  // (intern: subprocess spawn + lifecycle handler)
};
```

**Dependencies:** `child_process.spawn` oder `execSync` (vermutlich letzteres),
`db.run/getAll/save` aus `lib/db.js`, evtl. OpenClaw-Gateway-URL/Token aus ENV.
**LOC-Schätzung:** ~80 Zeilen raus (Zeilen ~1226-1310 inkl. Helper)
**Aktuell:** Implementierung muss gegen `index.js` Zeilen 1226-1310 verifiziert werden,
Trajectory endete vor diesem Block.

**Sicherheits-Hinweis (F8):**
- `execSync` blockiert Event-Loop — bei Vidi-Research-Latency (5-10 Min) ist das **fatal**.
- Empfehlung: `spawn` mit Pipe für stderr, Timeout (default 600s), Cleanup on Crash.

### 2.4 Was bleibt in `index.js`?

- Express-App + Routes (`app.get/post/put/...`)
- Global JSON-Error-Handler
- Static-File-Serving (`express.static('frontend')`)
- App-Bootstrap (`async () => { await init(); app.listen(); }()`)
- Logging-Setup (`log` object)

Geschätzte Reduktion: `index.js` von **1516 → ~700 LOC**.

## 3. Migrations-Reihenfolge

### Schritt 1: `lib/db.js` extrahieren (1-2h)
- Begründung: **Niedrigstes Risiko**, **höchster Test-Enablement-Wert**
  - DB-Wrapper sind zustandslos (keine externen Calls)
  - Sofort mit `node --test` testbar (in-memory DB + Migrationen)
  - Andere Module brauchen `lib/db.js` → Dependency-Stamm
- Verifikation: alle bestehenden Routes weiterhin grün, `npm start` ohne Änderung

### Schritt 2: `lib/vidiq.js` extrahieren (3-4h)
- Begründung: **Mittleres Risiko**, weil:
  - `isValidBalance` ist subtil — Refactor muss das Verhalten 1:1 erhalten
  - Cache-Merge-Logik (Stats + Balance + Watchtime + LatestVideo in einen JSON-Blob) muss
    erhalten bleiben
- Achtung: `_watchtime` Sidecar-Key im `vidiq_cache.data` JSON — bitte mit Test absichern
- Verifikation: `POST /api/vidiq/refresh` End-to-End (mock'd MCP wenn nötig)

### Schritt 3: `lib/research.js` extrahieren (4-6h)
- Begründung: **Höchstes Risiko**, weil:
  - Subprocess-Management ist fragil (env-Pass, timeout, stderr, exit codes)
  - Research-Jobs haben langlebigen State (`research_jobs` Tabelle)
- Zusätzlich: F8 lösen — saubere Promise-basierte Wrapper statt rohem `execSync`
- Verifikation: End-to-End-Test mit Mock-Subprocess (siehe qabot P0-Vorschlag)

### Schritt 4: Routes in `lib/routes/*.js` aufteilen (optional, 4-6h)
- Nur wenn 1-3 stabil sind. Andernfalls: YAGNI.
- Vorschlag: `lib/routes/scripts.js`, `lib/routes/videos.js`, `lib/routes/vidiq.js`,
  `lib/routes/research.js`, `lib/routes/misc.js`
- Pattern: `(app, db, vidiq, research) => { app.get(...); }`

## 4. Risiko-Matrix

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| `applyUpdate` Verhaltens-Drift | mittel | hoch | Snapshot-Tests vor/nach, Route-Outputs byte-genau vergleichen |
| `parseVidiqResponse` Edge-Cases | hoch | mittel | Snapshot-Tests mit echten vidIQ-Antworten (siehe Commit `9ca57ae`) |
| `execSync` → Subprocess-Pattern-Wechsel | hoch | hoch | NICHT in diesem Refactor ändern, separates Issue |
| Module-Load-Order-Fehler | mittel | mittel | `module.exports` als Function-Factory `(deps) => ({...})` |
| `isValidBalance` Logic-Drift | mittel | hoch | Eigener Unit-Test mit Parse-Fail-Beispielen |
| `_watchtime` Sidecar-Loss | niedrig | mittel | Test: Write Sidecar → Read → Sidecar zurück |
| Migration bricht `npm start` | mittel | hoch | Inkrementell, mit `npm start` Smoke-Test pro Schritt |
| `crypto.randomUUID()`-Verhalten in Docker | niedrig | niedrig | Bereits gefixt in Commit `912e4b8` |

## 5. Empfehlung

**Inkrementell, mit Tests zwischen den Schritten.**

**Aufwandsschätzung:**
- Schritt 1 (db.js): **1-2h + 1h Tests** = 3h
- Schritt 2 (vidiq.js): **3-4h + 2h Tests** = 6h
- Schritt 3 (research.js + F8-Fix): **4-6h + 2h Tests** = 8h
- Schritt 4 (Routes-Aufteilung): optional, **+8h**

**Gesamt: 17-25h für die sichere Variante. Schritt 4 ist nice-to-have.**

**Reihenfolge-Begründung:** DB zuerst, weil:
1. Niedrigstes Risiko
2. Sofort testbar (in-memory DB + Assertions)
3. Andere Module brauchen DB als Dependency
4. Wenn was bricht, ist es das DB-Modul — einfachster Rollback

**Big-Bang-Alternative:** Ein großer PR mit allem. Spart Merge-Konflikte, aber:
- 700 LOC Diff in einem Commit
- Schwerer zu reviewen
- Schwerer zu rollbacken bei Bug

Für ein Local-First-Tool mit nur-Dirk-Maintainer ist Big-Bang vertretbar, aber
**für den Lerneffekt** (Patterns für künftige Refactorings) ist inkrementell besser.

## 6. Bonus-Empfehlungen

1. **JSDoc-Types** für die neuen Module — Vanilla-JS, aber Type-Hints via JSDoc + VSCode
   IntelliSense macht das Leben leichter.

2. **`lib/errors.js`** — Gemeinsame Error-Klassen (NotFoundError, ParseError, ExternalAPIError)
   statt überall `res.status(500).json({ error: e.message })`.

3. **`lib/config.js`** — Alle ENV-Vars zentral (`VIDIQ_API_KEY`, `OPENCLAW_GATEWAY_URL`,
   etc.), mit Validation beim Boot.

4. **Test-Helper:** `lib/test-helpers.js` mit `createTestDB()`, `mockVidiqResponse()`,
   `tempContentixApp()` — sobald 3+ Tests existieren, lohnt sich das.

---

*By Nix 🐧, 2026-08-26. "Be resourceful, not performative."*
