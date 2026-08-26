# Contentix v1 — Architektur-Review (Nix/main, 2026-08-26)

> **Methodik:** Manuelle Sicht (Archbot-Run wurde nach 44 Min abgebrochen). Gelesen wurden
> `AGENTS.md`, `docs/architecture.md`, `docs/adr-001-state-store.md`, `index.js` (Top + Routes),
> `frontend/store.js`, `Dockerfile`, `docker-compose.yml`, `package.json`, `frontend/calendar.js`,
> `tests/`-Inhalt, `*.bak-*`-Files im Repo. v2-Konzept (`/var/srv/shared/projects/contentix-v2/`)
> wurde bewusst ignoriert.

## 1. Executive Summary

### Stärken
- **API ist exzellent dokumentiert** (`AGENTS.md`). Jedes Endpoint, jedes Feld, jede
  Status-Migration. Das ist Vorbild-Niveau für ein Local-First-Tool.
- **ADR-001 State-Store-Migration** ist klar durchdacht (Custom Mini-Store, ~150 LOC,
  kein Framework-Lock-in) und tatsächlich umgesetzt — alle drei Phasen committed.
  Frontend spricht schon `store.select(state => state.x)`, Action-Funktionen haben
  Optimistic-Update + Rollback eingebaut.
- **Persistenz-Layer ist robust.** sql.js mit atomic temp-write + rename (Commit
  `9ca57ae`), Coalesced-Saves, `.bak`-Rotation. DB-Atomicity-Problem war real und ist weg.
- **Error-Handling ist pragmatisch.** Global JSON-Parse-Error-Handler vor allen Routes,
  fatal-only-on-missing-VIDIQ-Key, klare Trennung LOG_LEVEL.
- **Test-Convention ist definiert** (node --test für Pure-Funktionen, Playwright für
  DOM). `tests/store.test.js` ist mit 17 KB substanziell.

### Risiken (Top-5)
- **Doku-Drift:** `docs/architecture.md` behauptet "better-sqlite3 (NO Docker)" — Realität
  ist `sql.js` + existierender Dockerfile + docker-compose.yml. Verfälscht Bild für
  jeden, der ohne `git log` reinkommt.
- **index.js ist 1516 Zeilen, alles in einer Datei.** Routes, MCP-Client, Background-Jobs,
  Atomic-Write-Logik, Vidi-Research-Spawn, vidIQ-Watchtime — keine Schicht-Trennung.
  Mitwachsende Komplexität kostet auf Dauer Onboarding-Zeit.
- **Frontend hat noch inkonsistente State-Quellen.** `frontend/calendar.js` deklariert
  oben `let currentDate / currentView / selectedDay / weekIndex` als modul-globals
  (lokal OK), ruft aber an anderer Stelle `getAllCards()` als Store-Wrapper auf. Im
  Working Tree (nicht committed) ist noch unklar, ob die Migration überall vollständig
  ist. `kanban.js`/`history.js` brauchen dieselbe Prüfung.
- **External-Service-Spawn unklar gekapselt.** OpenClaw-Gateway wird per `execSync`
  aufgerufen — Subprocess-Management ist risikoreich (timeout, stderr, exit codes).
  v0.10+ Vidi-Research braucht hier eigene Resilience.
- **Uncommitted Working Tree:** `frontend/calendar.{js,css}` modifiziert (nicht
  committed), `contentix.code-workspace` untracked. Calendar-Code ist also gerade
  mitten in Entwicklung.

## 2. Konkrete Findings (priorisiert)

### P0 — Sofort anschauen

**F1. Doku-Drift in `docs/architecture.md`**
- Behauptet "better-sqlite3 (NO Docker)" und "systemd service", nennt Stack &
  Deployment falsch.
- Realität: `sql.js` (siehe `package.json` + `index.js:10`), `Dockerfile` +
  `docker-compose.yml` existieren und sind aktuell.
- Auswirkung: Wer denkt, das Ding laufe per systemd, baut die falsche Annahme auf.
- Empfehlung: Entweder Doku updaten ODER docker-compose entfernen, falls doch systemd-Only.
  **Frage an Dirk: Was ist der echte Deployment-Pfad?**

**F2. Calendar.js hat uncommitted Working-Tree**
- Files: `frontend/calendar.css` + `frontend/calendar.js` (modified), `contentix.code-workspace` (untracked).
- Risiko: Lokal läuft was, das nicht im Repo ist. CI/Clone funktioniert anders als Production.
- Empfehlung: Entweder committen (mit ordentlichem Changelog-Eintrag) oder stashen + Issue anlegen.

**F3. Verwaiste `.bak-*`-Files im Working-Tree**
- `frontend/scripts.js.bak-pre-autosave-fix` (nicht committed, ~100 KB Backup vom 19.06.)
- `contentix.db.bak-pre-atomicity` + `.bak2-pre-atomicity` (471 KB, vom 18.06.)
- Risiko: Repo-Hygiene; irritiert beim ersten Klon.
- Empfehlung: Backup-Files in `.gitignore` + aus Working-Tree räumen (siehe MEMORY-Notiz
  von 18.06.: "Backup-Files vor den Changes"). DB-Backups gehören in `/var/srv` nicht ins Repo.

### P1 — Diese Woche

**F4. `index.js` hat 1516 Zeilen ohne Modulgrenzen**
- Routes, MCP-Client (ab Zeile 849), Atomic-Write-Helper, Research-Spawn (ab Zeile 1226),
  Healthcheck, alle in einer Datei.
- `Dockerfile` kopiert nur `index.js` + `frontend/`, also Refactoring ist unkritisch
  für den Build.
- Empfehlung: Schicht-Trennung in `lib/`:
  - `lib/db.js` — sql.js-Lifecycle + atomic write
  - `lib/vidiq.js` — MCP-Client + Balance-Helper
  - `lib/research.js` — OpenClaw-Spawn-Logik
  - `lib/routes/*.js` — Express-Handler
- Konkrete Stellen mit Refactor-Potenzial für `refactorbot`:
  - `index.js:649-815` (vidIQ-MCP-Calls, watchtime, balance)
  - `index.js:1226-1310` (Vidi-Research: POST /api/research, polling, subprocess)
  - `index.js:1060-1126` (Refresh-Job-Lifecycle)

**F5. Frontend-State-Migration möglicherweise unvollständig**
- ADR-001 Phase 3 sagt "all views migrated". `calendar.js` ist im Working Tree und
  nutzt schon `store.select`, aber: `kanban.js` und `history.js` wurden in dieser
  Sicht nicht gelesen.
- `scripts.js.bak-pre-autosave-fix` deutet auf einen vorigen Migrations-Stand.
- Empfehlung: `refactorbot` soll `kanban.js` und `history.js` gezielt auf verbleibende
  `let allX = []`-Globals prüfen.

**F6. `frontend/store.js` Action-API ist `videos`+`scripts`, aber `history.js` lebt außen vor**
- Im Store sind `history` als leeres Array initialisiert, aber keine `loadHistory`/`archiveVideo`/`restoreVideo`-Actions.
- Tatsächliche Endpoints existieren (`/api/history`, `/api/videos/:id/archive`).
- Auswirkung: Wer `history` als Store-Datenquelle nutzen will, muss selbst fetchen.
- Empfehlung: Actions ergänzen — analog zu `loadVideos`/`updateVideo`.

### P2 — Nice to have

**F7. `index.js:135` atomic-write blockiert bei `JSON.stringify(state)`-Equality**
- Im Store: `setState` macht JSON-Vergleich vor/nach. Bei großen State-Snapshots
  (200+ Videos/Scripts) ist das jedes Mal O(N) Serialisierung.
- Empfehlung: Shallow-Compare für top-level keys + per-slice-Compare (Scripts,
  Videos separat). Oder gleich strukturelles Cloning (Immer-Style).

**F8. External-API-Spawn ohne saubere Kapselung**
- OpenClaw-Gateway-Calls passieren in `index.js` direkt (vermutlich `execSync`).
- Kein Timeout-Handling, kein stderr-Pipe, kein Cleanup bei Crash.
- Empfehlung: Eigenes Modul `lib/openclaw-client.js` mit Promise-Wrapper, Timeout
  (default 300s), sauberem stderr-Logging.

**F9. Tests decken nur 3 Files ab**
- `tests/`: `hero-fallback.spec.js`, `sort-comparator.test.js`, `store.test.js`.
- Keine Tests für Backend-Routes (`index.js`), für MCP-Client, für Research-Spawn.
- Empfehlung: `qabot` soll eine Test-Coverage-Lücke-Analyse machen.

**F10. `mockup/`-Ordner enthält 16 PNG-Dateien**
- Bibliothek-Redesign-Mockups (`lib-cards-rest.png`, `lib-hover-*.png` etc.)
- Im Repo = ~mehrere MB, irrelevant für die App.
- Frage an Dirk: Gehören die ins Repo (für Doku-Verweise) oder besser in ein Wiki/Shared-Volume?

## 3. Architektur-Skizze

```
┌─────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                             │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │bibliothek│ │ kanban   │ │ calendar │ │ scripts  │ │ history  │    │
│  │  .js     │ │  .js     │ │  .js     │ │  .js     │ │  .js     │    │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘    │
│       │            │            │            │            │          │
│       └────────────┴────────────┴────────────┴────────────┘          │
│                            │                                        │
│                     ┌──────▼──────┐                                 │
│                     │  store.js   │   Custom Mini-Store (ADR-001)   │
│                     │  singleton  │   - select / subscribe          │
│                     │             │   - actions (CRUD + Optimistic) │
│                     │ window.     │                                 │
│                     │ ContentixStore                                │
│                     └──────┬──────┘                                 │
│                            │ fetch('/api/...')                      │
└────────────────────────────┼────────────────────────────────────────┘
                             │ HTTP/JSON
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NODE.JS SERVER (index.js, 1516 LOC)                                 │
│                                                                     │
│  ┌──────────────────── Express Routes ─────────────────────────┐    │
│  │ /api/scripts/*        CRUD + import + restore + folders      │    │
│  │ /api/videos/*         CRUD + archive/restore + link          │    │
│  │ /api/vidiq/*          stats + refresh jobs + watchtime        │    │
│  │ /api/research/*       Vidi job lifecycle (POST/GET/DELETE)   │    │
│  │ /api/history          archived videos                       │    │
│  │ /api/health           version + db-status                    │    │
│  └────────────────────────┬────────────────────────────────────┘    │
│                           │                                         │
│  ┌────────────────────────▼────────────────────────────────────┐    │
│  │ lib-Kandidaten (FEHLEN aktuell, alles inline in index.js):   │    │
│  │  • db.js          sql.js lifecycle + atomic write           │    │
│  │  • vidiq.js       MCP client + cache helpers                │    │
│  │  • research.js    OpenClaw subprocess spawn                 │    │
│  │  • migrations.js  Schema versioning                         │    │
│  └────────────────────────┬────────────────────────────────────┘    │
│                           │                                         │
│                  ┌────────▼─────────┐                               │
│                  │   sql.js DB       │  contentix.db (atomic write) │
│                  │   videos          │                               │
│                  │   scripts         │                               │
│                  │   vidiq_cache     │                               │
│                  │   vidiq_refresh_jobs                              │
│                  │   research_jobs   │                               │
│                  └──────────────────┘                                │
│                                                                     │
│  External:                                                         │
│   → vidIQ MCP (https://mcp.vidiq.com/mcp) — JSON-RPC over HTTP      │
│   → OpenClaw Gateway (HTTP localhost:18789) — agent spawn           │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. Open Questions für Dirk

1. **Deployment-Pfad:** systemd ODER Docker? `docker-compose.yml` ist aktiv, aber
   `architecture.md` behauptet systemd-Only. Was ist die Wahrheit?
2. **Calendar-Working-Tree:** Was ist da gerade in Arbeit? Soll ich's committen oder
   zurückziehen?
3. **Backup-Strategie:** Wo leben die `*.bak-pre-*`-Files langfristig? In `/var/srv` oder
   aus dem Repo ganz raus?
4. **Mockup-Ordner:** Im Repo lassen oder in `/var/srv/shared/projects/contentix/mockup/`?
5. **Vidi-Research-Lifecycle:** Bleibt das subprocess-Spawn-Pattern, oder wollt ihr auf
   eine Job-Queue (z.B. in `research_jobs` als Work-Table) migrieren?

## 5. Übergabe an die anderen Bots

### Für `refactorbot` (Code-Quality):
- **Hotspots:** `index.js:649-815` (vidIQ-MCP), `index.js:1060-1126` (Refresh-Job),
  `index.js:1226-1310` (Research-Spawn).
- **Auftrag:** Extrahiere diese drei Blöcke in `lib/`-Module ohne Verhaltensänderung.
  Tests müssen grün bleiben.
- **Vorsicht:** MCP-Client hat MCP-Protocol-Edge-Cases (siehe AGENTS.md MCP-Section).
  Kein "vereinfachter Wrapper", der SSE-Handling verliert.

### Für `designbot` (UX):
- **Hotspots:** `frontend/calendar.{js,css}` (Working Tree), `frontend/bibliothek.{js,html}`,
  `frontend/kanban.js`.
- **Auftrag:** UX-Review der Hauptansichten. Schwerpunkt: Konsistenz State-Sync zwischen
  Views (synchronisieren sich die richtig nach einer Mutation?), visuelle Konsistenz
  (Theme "Nix-Violett" überall angewendet?).
- **Mockup-Vergleich:** `mockup/bibliothek-v2*.png` vs. aktueller `bibliothek.html`.

### Für `qabot` (Tests + Edge-Cases):
- **Hotspots:** `index.js`-Routes (alle Handler ohne Tests), `lib/vidiq.js` (MCP-Client),
  `lib/research.js` (Subprocess-Management).
- **Auftrag:** Coverage-Lücken-Analyse. Welche Routes haben keine Coverage? Welche
  Edge-Cases (DB-Migration, MCP-Timeout, Subprocess-Crash) sind ungetestet?
- **Konvention:** Pure-Logik → `node --test`, DOM/Browser → `playwright test`.

---

*By Nix 🐧, 2026-08-26. "Be resourceful, not performative."*