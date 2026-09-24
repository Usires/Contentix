# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **🤖 Vidi 2.0 — local AI content-buddy (optional add-on)**: Contentix
  now ships an optional, opt-in service that does proactive topic
  discovery plus script-drafting via local Ollama models. Contentix
  stays fully functional without Vidi — the service is detected via
  health-check and UI renders conditionally. Ships in `vidi2/` with:
  - **Backend (Phase 1.1):** 6 Contentix routes (`/api/vidi/status`,
    `/api/vidi/inbox`, `/api/vidi/inbox/:id/approve`,
    `/api/vidi/inbox/:id/reject`, `/api/vidi/runs`, `/api/vidi/settings`)
    plus `vidi_suggestions` and `vidi_runs` DB tables. Approval
    auto-creates a `videos` row in the research lane.
  - **Service (Phase 2):** FastAPI on port 8191 with `/status`,
    `/run/discovery`, `/runs`, `/settings`. Includes Ollama model
    detection (qwen3.5, gemma4:12b, ornith), cloud-fallback toggle
    for M3, cron expression for periodic discovery.
  - **UI (Phase 1.2 v1–v8):** floating layer with backdrop, draggable
    panel with `localStorage`-persisted position, theme-consistent
    colors via tokens (auto-adapts to spring/summer/autumn/winter),
    Approve/Reject actions wired to the backend.
  - **Docker:** separate `docker-compose.vidi.yml` for opt-in deploy.
  - **✅ Phase 3 wired up (this entry supersedes the earlier "still
    stubbed" status):** The real discovery pipeline is now active.
    `service.py` `/run/discovery` calls `discovery.py:run_discovery()`
    (Pull→Classify→Trend→Synthesize→Push). Three bugs in the original
    wiring got fixed:
    - `yt_search.py` was calling `/mcp/call` — the MCP server actually
      exposes tools at `POST /tool/<tool-name>`.
    - YT-MCP returns CamelCase keys (`videoId`, `publishedAt`), but
      `yt_search.load_trending_signals` was reading snake_case —
      so dedup-filtered everything to zero. Fixed by normalising to
      snake_case inside `call_mcp_search`.
    - `chat_json` was burning the entire `num_predict` budget on
      internal `thinking` tokens (qwen3.5, ornith-1.5 are thinking-
      capable models), returning empty content. Fixed by passing
      `think: false` so the JSON output actually gets produced.
    - `_discovery_stub` (the Phase-2 placeholder) is now a deprecated
      no-op so old callers don't crash if anything still references it.
    First live run produced a real card:
    *"Warcraft III unter Linux: Der ultimative Guide für Mods & Performance"*
    with confidence 0.85.
  - **⚠️ Known limitations:** (1) `lilac_archive.load_recent_items`
    returns nothing because the LILAC newsletter hasn't run since
    April 2026 — the YT-search half of the pipeline works fine. (2)
    YouTube Data API v3 has a per-day Search-Query quota — heavy
    testing in one session will burn it. (3) Classifier is still
    conservative: most items come back with channel_fit < 0.5 and
    get filtered. Reasonable, but a few more tuning iterations would
    raise throughput.
  - **Default model switched to ornith-1.5:9b** — Vidi's
    `OLLAMA_AGENT_MODEL` default is now `ornith-1.5:9b` (was
    `ornith:latest`). 1.5 gives sharper insights on the script-
    drafting tasks per A/B test. Override per-deploy via env var.
  - **Phase 4+ (cron setup, mode 3 script drafting):** spec'd in
    `vidi2/SPEC.md`, not yet implemented.
- **🔐 YouTube OAuth self-service setup (v0.13.1+):** Contentix now ships
  with everything needed for a fresh install to grant YouTube access
  on its own — no manual token-file editing. Adds:
  - `npm run oauth:setup` — interactive wizard that asks for Client ID
    + Secret, generates the Google auth URL, accepts the redirect
    URL (works over SSH tunnels), and saves the token automatically.
  - `npm run oauth:check` — CLI status check (human / JSON / exit code)
    suitable for cron or monitoring scripts.
  - `GET /health/oauth` on the MCP server — live health check via the
    cheapest authenticated YouTube API call. Returns 200 with
    `status: "healthy"` or 503 with `status: "expired"`. Drop the URL
    into Uptime-Kuma or any HTTP monitor.
  - `docs/oauth-setup.md` — complete guide for new users (GCP project,
    API enablement, OAuth consent screen, client credentials, the
    three supported browser-flow scenarios).
  - README updated with OAuth section, new env vars, and a
    Troubleshooting entry that points to `oauth:check`.
- **📋 Server-Logs in Settings (Phase 1 of 2):** Adds a live log-viewer
  card to the Settings tab as a second column to the YouTube cache
  settings — a single place for error-research when something is off.
  - `data/contentix.log` is now persisted alongside the database
    (rotated at 5 MB, 3 generations kept, oldest dropped). Level is
    encoded in the line so frontend can colorise.
  - `GET /api/logs?lines=200&level=INFO|WARN|ERROR&search=foo` returns
    the tail (across current + rotated generations), with optional
    level filter (>=) and case-insensitive substring search.
  - `frontend/logs.js` (new) renders the tail in a `<pre>` with a
    monospace, scrollable panel, 10-second auto-refresh, and
    filter chips (Alle / INFO / WARN / ERROR). Auto-refresh only runs
    while the Settings tab is active — saves a fetch per second when
    you're on Kanban / Calendar.
  - The follow-up (SSE-based live streaming instead of polling) is
    tracked as NixBoard card **LOGS** (Backlog).

### Changed
- **🔒 YouTube-import locks (Phase 2+1):** videos imported from
  YouTube are now marked `is_locked=1` so the schema-validated
  `rejectLockedEdits()` middleware returns HTTP 423 on manual
  PATCH/PUT. UI badge (🔒) signals locked items. This protects
  scraped data from being clobbered by stale UI forms.

### Removed
- **🗑️ `board__column-toggle` legacy CSS** (Phase 1.2 refactor):
  magic-hex styles from the abandoned "Vidi-Lane-as-column"
  prototype. Replaced by the floating-layer pattern with tokenised
  colors.

### Fixed
- **🐛 Drag-jump on Vidi panel** (Phase 1.2 v4–v5): moved from
  `position: calc(...) + var(...)` CSS custom-properties to
  direct `style.top` / `style.left` inline writes with
  `will-change: top, left` — eliminates the ~8px compositor jump
  that the earlier v1–v3 implementation showed on first drag.
- **🐛 Readability on Vidi cards** (Phase 1.2 v6–v7): card title
  and hook were dark on dark sidebar background. Now use
  `var(--text-on-dark)` / `var(--text-on-dark-secondary)` so the
  text is legible across all five themes.

---

## [Unreleased]

### Added
- **📋 4-Bot audit reports** (`docs/archbot-review-2026-08-26.md`,
  `docs/qabot-test-coverage-2026-08-26.md`,
  `docs/refactorbot-lib-plan-2026-08-26.md`,
  `docs/designbot-ux-review-2026-08-26.md`): Nix/main authored these
  on 2026-08-26 after orchestrating four subagent reviews
  (`archbot`, `qabot`, `refactorbot`, `designbot`) on the live
  Contentix v1 tree. Each report carries P0/P1/P2 findings plus
  concrete next steps. The subagent runs were the first
  multi-bot audit on this repo and exposed several patterns the
  bot spawning pipeline should adopt (see the NixBoard CONT card).
  Findings worth tackling first:
  - **U1** card title truncation in the Bibliothek grid
    (Mockup vs. Live comparison in `designbot-ux-review`).
  - **U2** duplicated cards across the "Letzte 6" and
    "Evergreens" sections (same card showing in both).
  - **F1** `docs/architecture.md` still claims
    "better-sqlite3 (NO Docker)" but the tree ships
    `sql.js` plus a working `Dockerfile` and `docker-compose.yml`.
  - **F2** `frontend/calendar.{js,css}` modified, not committed
    — the calendar Working Tree is live but unreviewed.
  - **qabot P0** `/api/scripts/import` accepts absolute paths
    via `filePath.startsWith('/')` and skips the
    `/home/dirk/yt-research/` guard — real path-traversal
    exposure if anyone other than `dirk` can reach the route.
  - **refactorbot plan** suggests an incremental
    `lib/db.js → lib/vidiq.js → lib/research.js` extraction
    (17–25h for the safe path; step 4 route splitting is optional).

### Changed
- **♻️ Centralised UPDATE-handler logic via `applyUpdate()`**: The PUT
  `/api/scripts/:id`, PUT `/api/videos/:id`, and PATCH `/api/videos/:id`
  handlers each carried ~30 lines of duplicated `if (field !== undefined)
  updates.push(...)` code. Extracted into `applyUpdate(table, id, fields,
  allowedColumns, preEncode)` with `SCRIPT_COLUMNS` (9 fields) and
  `VIDEO_COLUMNS` (15 fields) as single-source-of-truth allowlists.
  Adding a new column now means one allowlist entry + a schema migration
  instead of three synchronised edits. JSON encoding for `tags` handled
  via the `JSON_ENCODE_COLUMNS` map so the helper stays generic across
  tables that don't share the same pre-processing needs.
- **♻️ Extracted `callVidiqTool()` for vidIQ MCP calls**: The pattern
  `execSync(vidIqCmd(N, 'tool_name', args)) → parseVidiqResponse(output)`
  was duplicated 11 times across `runVidiqRefresh` (Steps 2–5 + per-video
  cache loop). New helper centralises the call + parse + error-handling,
  with a `TOOL_IDS` map replacing the magic numbers sprinkled through
  the refresh. Step 6 (watchtime) keeps its bespoke async helper since
  it has different error-recovery semantics.
- **⚡ `store.select()` no longer deep-clones by default**: The previous
  implementation called `JSON.parse(JSON.stringify(state))` on every
  read, which dominated allocation cost on render-heavy paths (kanban
  drag-and-drop, calendar). The clone is now opt-in via
  `select(selector, { immutable: true })` for the rare caller that
  intends to mutate the result. ADR-001 already requires read-only
  treatment of state, so the clone was redundant overhead. Hot paths
  measured ~30% less allocation in profiling.

### Fixed
- **🐛 Refresh overwrote good cache `balance` with `{}` when vidIQ API was down**:
  when `vidiq_balance` returned an envelope like
  `{result:{content:[{type:"text", text:"Something went wrong..."}]}}`,
  `parseVidiqResponse` returned `null`, the default `balance = {}` was
  merged into the cache, clobbering any previously-valid balance with
  empty data. Symptom: even after a refresh succeeded for stats/videos,
  the credits display stayed at "—" instead of recovering as soon as
  vidIQ returned to normal. Fix: only write `balance` to the cache when
  the new object actually has at least one numeric credit field
  (`renewableCredits` / `addOnCredits` / `maxRenewableCredits`). Same
  guard added to `GET /api/vidiq/balance-live` so the live escape-hatch
  also refuses to clobber good data when vidIQ returns a non-balance
  envelope.
- **🐛 Credits display showed "0" instead of "—" when vidIQ was unreachable**:
  `loadVidiqCredits()` read the cached `balance` blob, and if it was
  empty (`{}`) — e.g. after a parse failure or while vidIQ is down —
  it fell through to `renewableCredits ?? 0 = 0`, making the badge
  show `💳 0` in red. User couldn't tell "no credits" from "I
  don't know". Fix: if the balance object has no recognizable fields
  (`renewableCredits`, `addOnCredits`, `maxRenewableCredits`), try one
  `/api/vidiq/balance-live` read before displaying. Only show "— nicht
  verfügbar" if that also fails.

### Fixed
- **🐛 vidIQ refresh trapped in "0-Credit-Loop" on stale/empty cache**:
  the pre-flight gate in `refreshVidiq()` reads the cached balance from
  `/api/vidiq/stats` and bails with `✗ vidIQ-Credits leer — Reset …`
  if `total ≤ 0`. But if the cached `balance` blob is empty (`{}` from a
  previous parse failure) the gate bails **forever** because the
  refresh job — the only thing that ever writes a fresh `balance` —
  is the thing being refused. Symptoms: the UI sticks at "Credits leer"
  even when vidIQ has credits again, the button has to be coaxed back
  to life manually.
  Fix:
  1. **Backend**: new `GET /api/vidiq/balance-live` — bypasses cache,
     calls `vidiq_balance` directly, merges the result back into
     `vidiq_cache.data.balance`. Self-heals the cache for any later
     pre-flight that doesn't go live.
  2. **Frontend**: `refreshVidiq()` pre-flight now treats an empty
     `balance` blob the same as `total ≤ 0` and triggers one live
     read before deciding to hard-stop. If the live call fails (e.g.
     vidIQ API hiccup), the gate falls through to a visible warning
     (`⚠ Credit-Stand nicht abrufbar (vidIQ-Fehler) — Refresh startet trotzdem`) and lets the refresh run anyway — the user can
     see the real failure inside Step 3 instead of being stuck.

## [0.13.1] — 2026-07-02

### Added
- **📊 Step-by-step vidIQ refresh progress in the UI**: every `updateProgress()`
  call now writes a human-readable `current_step` label (e.g. `📊 Kanal-Statistiken
  werden geladen…`, `⏱️  Watchtime wird geladen… (5 Credits)`,
  `🔄 Video 17/31 wird geladen… (1 Credit)`). The frontend's
  `refreshVidiq()` poll reads `job.currentStep` and shows it instead of
  the old generic `Lade Daten… (0%)` placeholder. Added a new
  `current_step TEXT` column to `vidiq_refresh_jobs` via best-effort
  `ALTER TABLE` (idempotent for fresh DBs).
- **💳 vidIQ credit balance always visible under the refresh button**:
  new `<div id="vidiqCredits">` block shows `💳 96 / 2,000  ·  Reset 01.07. 10:25`
  with a hover tooltip breaking out renewable vs. add-on buckets. Color
  states: amber when below 20% of the renewable cap, red when zero. After
  a successful refresh the UI shows `✓ Fertig! · 14 Credits verbraucht`
  (delta between pre- and post-refresh balance).
- **🛑 Pre-flight credit gate on refresh**: `refreshVidiq()` now snapshots
  the balance from `/api/vidiq/stats` *before* firing the POST. If
  `total ≤ 0`, the refresh is **refused entirely** with
  `✗ vidIQ-Credits leer — Reset 01.07. 10:25` (no MCP call wasted, button
  switches to `⟳ Retry`). Below `WARN_LOW_CREDITS = 30`, a yellow
  `⚠ Nur X Credits übrig — Refresh startet trotzdem` notice flashes for
  ~800ms before the polling kicks in, so the user sees the warning before
  the step-label takes over. Threshold `REFRESH_MIN_CREDITS = 10` is
  reserved for a future server-side gate (not enforced client-side yet
  because the balance check is a free endpoint call).

### Fixed
- **🐛 vidIQ refresh — `started_at` always NULL in job table**: the v0.10
  `started_at`, so every job row ended up with `started_at = NULL`. This
  broke `ORDER BY started_at DESC` (NULLs sort first or last depending on
  the SQLite build) and made it look like there hadn't been any refreshes
  since the column was added. Fix: schema now declares
  `started_at TEXT DEFAULT (datetime('now'))`; existing rows are
  backfilled with `COALESCE(finished_at, datetime('now'))`; new jobs also
  write `started_at` explicitly in the POST handler as a belt-and-braces
  measure.
- **🐛 `crypto.randomUUID is not a function` when creating a new script/video**:
  `crypto.randomUUID()` is only available in secure contexts (HTTPS or
  `localhost`). Contentix runs as a plain-HTTP LAN app
  (`http://asbach-games.fritz.box:PORT`), where `window.crypto` exists
  but `randomUUID` is undefined. Symptom: clicking "Speichern" on the
  new-script modal threw and the record never persisted. Fix: added a tiny
  `uuidv4()` polyfill in `utils.js` (uses `crypto.getRandomValues`
  which IS available in insecure contexts) and replaced the two
  `crypto.randomUUID()` call sites in `store.js` (`createScript`,
  `createVideo`) with `uuidv4()`. Also swapped the `<script>` load
  order in `index.html` so `utils.js` loads before `store.js` — the
  polyfill must be defined before any consumer references it.

### Added
- **📦 Central State Store (ADR-001 Phase 1)**: New `frontend/store.js`
  implementing `createStore(state)` with `select`, `subscribe`,
  `setState`, and a synchronous action set (`setActiveScript`,
  `setActiveView`). Async action set: `loadScripts`, `createScript`,
  `updateScript`, `deleteScript` — all with optimistic updates, server
  reconciliation, and rollback on error. Cancellation tokens for
  `loadScripts` so rapid successive calls cancel earlier in-flight
  requests. `select()` returns deep-cloned snapshots (read-only
  contract). 20/20 unit tests green in `tests/store.test.js`. Legacy
  API (`getAllCards` / `loadAllCards` / `setAllCards` /
  `onAllCardsChange`) kept as deprecated wrapper for kanban.js /
  calendar.js / app.js until Phase 3 migration.
- **🧪 Store unit tests**: `tests/store.test.js` — 20 specs covering
  seed isolation, snapshot semantics, subscriber exception isolation,
  unsubscribe-during-notification, async cancellation, and full
  optimistic-update + rollback round-trips for create/update/delete.

### Changed
- **🔌 scripts.js migrated to store (ADR-001 Phase 2)**: All `let
  allScripts` / `let activeScript` removed. Reads via
  `getAllScripts()` / `getActiveScript()` (thin store.select wrappers).
  Writes via `store.actions.{loadScripts, createScript, updateScript,
  deleteScript, setActiveScript}`. Subscribe-with-scripts-hash to
  avoid tearing down jsTreeInstance on ui-only state changes
  (activeScriptId toggles alone must NOT rebuild the tree — that was
  causing jstree's internal handler to call triggerHandler() on a
  destroyed instance, throwing in the console). Subscription guards:
  only render if the scripts container is visible AND the scripts
  data hash actually changed.
- **📡 PUT/POST /api/scripts return full record**: Was `{status:'ok'}`.
  Now returns the full updated/created record (with `tags` parsed from
  JSON). Required for store optimistic-update reconciliation. (Bug fix:
  the old stub-return was causing the store to overwrite the full
  record with `{status:'ok'}` after every update — silent corruption
  masked by every consumer re-fetching from the server.)
- **🔧 kanban.js bug fix (pre-existing, surfaced during Phase 2)**: The
  `renderBoard()` function referenced an undeclared `allCards` global,
  causing `ReferenceError: allCards is not defined` every time the
  Kanban view rendered. Replaced with `const allCards = getAllCards()
  || []` at the top of `renderBoard()`. Same fix applied to two other
  references in `archiveCard` and `restoreCard`. Kanban view now
  renders cleanly.

### Refactored
- **🔁 Script-Sort-Dedup (R2, WEAVE #102)**: Identische `.sort((a,b) =>
  (a.position||0) - (b.position||0) || a.title.localeCompare(b.title))`-Logik
  lebte zweimal in `scripts.js` (Zeile 107 + 183, `buildJsTree` und
  `select_node`-Handler). Jetzt zentral in `utils.js` als
  `getScriptSortComparator()`. Coercet `null`/`undefined` für `title` zu
  leerem String (war vorher ein latenter Crash-Pfad). Spec:
  `docs/r2-script-sort-spec.md`. Tests: `tests/sort-comparator.test.js`
  (12/12 grün, inkl. 200-Iterationen-Fuzz gegen Inline-Referenz für
  Behavior-Preservation).

### Changed
- **🎨 Search-Bar + List-Footer Theme-Compliance (WISP #104)**: Hardcoded
  RGBA-/Hex-Farben in `.scripts-search` und `.scripts-list-footer` durch
  Theme-Variablen ersetzt (`--bg-surface`, `--text-primary`,
  `--text-secondary`). Transparente Borders jetzt via
  `color-mix(in srgb, var(--text-primary) X%, transparent)` — folgen
  automatisch allen 4 Theme-Varianten (Light Cream / Forest / Coffee /
  Midnight) ohne separate Regel pro Theme. Visuell verifiziert via
  Playwright-Smoke (`/tmp/wisp-search-light.png`).

### Added
- **📋 ADR-001: Centralized State Store (FORGE #105)**: Architecture
  Decision Record für den Vorschlag, das verstreute `let`-State-Modell
  (5+ Module, 18+ globale Variablen) durch einen kleinen In-House-Store
  zu ersetzen. Entscheidung: Custom Mini-Store (~150 LOC, kein Redux/
  Zustand/MobX), phased Rollout (Phase 1 = Store + Tests; Phase 2-4 =
  Migration pro View + optionales Undo/Redo). Volltext:
  `docs/adr-001-state-store.md`.
- **🧪 Test-Runner: `node --test`** für Pure-Function-Tests
  (`tests/sort-comparator.test.js`). Playwright bleibt für Browser-Tests.
  Keine neuen devDependencies — `node:test` ist seit Node 18 stabil.

### Added (Phase 3 — 2026-06-25)
- **🎬 Video actions in store**: `loadVideos`, `createVideo`,
  `updateVideo`, `deleteVideo` — full async action set mirroring the
  script actions. Same optimistic + rollback pattern, same cancellation
  for rapid successive loads. 10 new unit tests (30/30 store tests
  total now).

### Removed (Phase 3 — 2026-06-25)
- **💀 Legacy store API deleted** (`getAllCards`, `loadAllCards`,
  `setAllCards`, `onAllCardsChange`). All consumers migrated to
  `store.select(s => s.videos)` / `store.actions.loadVideos()` etc.
  The legacy stub was the pre-Phase-1 mini-store; it's gone now.

### Changed (Phase 3 — 2026-06-25)
- **🎯 kanban.js migrated to store**: All direct fetches replaced with
  `store.actions.{loadVideos, updateVideo, deleteVideo, createVideo}`.
  Subscribe-with-hash pattern fires `renderBoard()` on videos data
  changes. Drop handler, archive, delete, duplicate, modal save — all
  route through the store.
- **📅 calendar.js migrated to store**: All 12 `loadAllCards()` /
  `getAllCards()` call sites converted. Direct fetch in
  `handleDayColDrop` replaced with `store.actions.updateVideo(id,
  { planned_date })` (optimistic + rollback). Subscribe-with-hash in
  `ensureCalendarSubscribed()`.
- **🖥️ app.js migrated to store**: Two call sites in the command
  palette (renderPaletteResults reads videos from store;
  openCardFromPalette triggers `store.actions.loadVideos` before
  opening the modal). history.js was already independent (uses its own
  `/api/history` endpoint, no migration needed).
- **📡 DELETE /api/scripts/:id and DELETE /api/videos/:id return full
  record**: Was `{status:'ok'}` / `{ok: true}`. Now returns the deleted
  record (with tags parsed from JSON) so the store's rollback path has
  the snapshot it needs. Same fix as the PUT/POST round-trip fix,
  applied to delete for symmetry.

## [0.13.0] — 2026-06-19
## [0.12.0] — 2026-06-19

### Security & Reliability
- **🔒 DB-Atomicity (`saveDB`)**: temp-file + atomic-rename + .bak-Backup.
  Schützt vor Datenverlust bei Crash/OOM/Disk-full mid-write. POSIX
  `rename()` ist atomar: entweder alte oder neue Version, nie halbe.
  Concurrent saves werden coalesced (kein pile-up). Pre-Save-Backup als
  letzte Verteidigung. Migration: 2x manuelle .bak-Dateien vor dem
  Change angelegt.
- **⚡ AutoSave ohne Tree-Rebuild**: `saveScript()` ruft jetzt nur
  `updateScriptNodeLabel()` statt `refreshTree()`, wenn nur Content/Title
  sich geändert haben. Folder/Status-Änderungen machen weiterhin den
  vollen Refresh. **Fix:** Cursor-Sprung und potenzieller Textverlust
  beim Auto-Save alle 30s — Textarea-DOM-Identität bleibt jetzt stabil.
  Verifiziert: `textareaMarker: "PRESERVED"` nach Save.

### Fixed
- **🎬 Bibliothek-Hero: 🎬-Klappe nicht mehr als Geist-Icon über Bild**
  (CLAP-Bug). `frontend/styles.css`: `.lib-hero-thumb.has-image::before {
  display: none; }` versteckt das CSS-Pseudo-Element, wenn das Bild
  erfolgreich lädt. `frontend/bibliothek.js`: onerror-Pfad bereinigt —
  entfernt jetzt zusätzlich die `has-image`-Klasse und fügt kein
  zusätzliches 🎬-Text-Knoten mehr ein (verhindert Doppel-Render bei
  Bild-Fehlschlag). CSS `::before` ist jetzt sauber nur-Fallback.

### Added
- **🟢 Approve & Move to Script-Button** im Skript-Editor.
  Zeigt sich nur, wenn das aktive Skript mit einem Video im
  Status `research` verlinkt ist. Ein-Klick-Move mit
  Bestätigungs-Dialog. Vermeidet das ständige manuelle
  Status-PATCHen per curl und macht den research → script
  Schritt für Dirk direkt in der UI erfahrbar.
- **📋 Status-Legende** in der Skripte-Sidebar: zeigt die 5
  Status-Emojis (⚪ Draft, 🟡 In Review, 🟢 Final, 📦 Archiviert,
  🎬 Mit Video verlinkt) mit Beschriftung. Verhindert, dass
  man sich die Bedeutungen merken muss — vorher nirgends
  dokumentiert.
- **🧪 Playwright-Test-Suite für Contentix** (Foundation).
  - `playwright.config.js`: testDir `./tests`, baseURL `http://localhost:3038`,
    sequenziell (single-user Node-App).
  - `tests/hero-fallback.spec.js`: 3 Regression-Tests für den
    CLAP-Bug — (1) Bild lädt → 🎬 versteckt, (2) Bild fehlt → 🎬
    sichtbar + Gradient, (3) Hero zeigt neuestes published-Video
    (API vs. UI Titel-Match). Sanity-Checked: bei Revert des CSS-Fixes
    schlägt Test 1 fehl — Tests sind echte Regression-Tests, nicht
    Theater-Tests.
  - `npm test` führt die Suite aus. Vorher: `npm install` für
    `@playwright/test` und `npx playwright install chromium`.
  - Foundation für weitere QA-Tests (Skripte-Tree, Workflow-Board,
    A11y-Smoke-Tests).

### Added
- **✂️ Text-Truncation mit Ellipsis** im Tree: lange Skript- und Folder-Namen
  werden jetzt sauber mit `…` abgekürzt (`text-overflow: ellipsis` +
  `white-space: nowrap`). Tree-Spalte scrollt nicht mehr horizontal.
  Voller Titel als HTML-`title`-Attribut für Tooltip beim Hover.
- **🌳 Skripte-Tree (JSTree-basiert)**: komplett neue Skripte-Sidebar.
  - 5 Default-Folder: `scripts`, `Entwürfe`, `channel`, `resources`, `Archiv`
  - **Drag & Drop**: Skripte zwischen Foldern verschieben, Reihenfolge ändern
  - **Status-Icons**: ⚪ draft, 🟡 in-review, 🟢 final, 📦 archived
  - **Status-Badges**: 🎬 für video-verlinkte Skripte, Wortzahl-Counter
  - **Live-Search** im Tree (highlighted matches)
  - **Right-Click-Context-Menü**: Skript (Öffnen/Duplizieren/Archivieren/Löschen),
    Folder (Neues Skript/Umbenennen/Löschen)
  - **localStorage-Persistenz**: offene/zu-geklappte Folder, letzte Suche
  - **Smart Archive**: Drag in Archiv-Folder setzt `status: "archived"`
    automatisch; Drag aus Archiv stellt auf `draft` zurück
  - **Archiv ist standardmäßig zugeklappt** (visual = weggeräumt)
  - **Custom Folder** anlegbar über Header-Button oder Context-Menü
  - **Folder-Icons**: 📁 zugeklappt, 📂 aufgeklappt, mit Hover-Scale-Effekt
  - **Single-Click Toggle**: Folder öffnen/schließen per einfachem Klick
    (vorher nur Doppelklick); Selection-Highlight wird gecleart
  - **wholerow-Plugin**: ganze Zeile ist klickbar, nicht nur der Text

### Fixed
- **🖱️ Klick-Bug bei langen Titeln**: durch das `wholerow`-Plugin wurden
  JSTree-Listenelemente über die Spaltenbreite hinaus gedehnt (Anchor
  477px in einer 280px-Spalte), sodass Klicks auf den Text ins Leere
  gingen. Fix: `wholerow`-Plugin entfernt, Tree-Container auf
  `overflow-x: hidden` gesetzt, `.jstree-children` korreliert mit Parent.
- **🛡️ Stack-Overflow in `renderPreview`**: lange Skripte (MechWarrior = 17k
  Zeichen) mit triple-backtick Code-Blocks sprengten den JS-Stack. Fix:
  Code-Fences werden via `split` separiert (kein backtracking), Input
  auf 50k Zeichen gecappt, Listen line-by-line verarbeitet.
- **🔄 Endlos-Loop bei `select_node`**: `selectScript()` rief
  `jsTreeInstance.select_node()` zur visuellen Sync auf, was wieder
  `select_node`-Event feuerte. Fix: visueller Sync nur über
  `state.selected` im Tree-Build, kein expliziter `select_node`-Call.
- **📁 Folder-Liste dokumentiert**: AGENTS.md listete 4 Folder auf, real
  waren nur 2 in der DB. Frontend hat jetzt eine hartcodierte Default-
  Liste + DB-Folder, was Migration erleichtert.
- **📦 3 archivierte Skripte in Archiv migriert** (NOLF, MSFS 2024, MangoHud).
  Eines davon (MSFS 2024) hatte eine falsche ID in der ersten Migration.
- **🌲 JSTree-Quirk: Single-Click auf Folder öffnete nicht**: JSTree's
  Default-`open_node()` ist ein No-Op für Folder, deren Children beim
  Schließen aus dem DOM entfernt wurden. Fix: vor `open_node()` die
  Children aus dem gecachten `allScripts`-Array re-injizieren.
- **💾 localStorage-Persistenz timing**: `persistTreeState()` lief
  synchron mit `open_node()`, bevor JSTree den State aktualisiert hatte.
  Fix: 50ms-Verzögerung vor dem Persist, damit der State korrekt ist.
- **🎯 Selection-Highlight auf Folder**: nach Klick blieb der Lila-Highlight
  auf Foldern kleben. Fix: `deselect_all(true)` mit Silent-Mode im
  setTimeout.

### Changed
- **`scripts.js`**: kompletter Rewrite (35.6 KB). Vanilla JSTree statt
  selbstgebauter Card-Liste. API-kompatibel zu vorher (alle Editor-Buttons
  funktionieren weiterhin).

### Security & Data
- ⚠️ **Wichtig**: Inhalt von `c442d667-734b-43f1-b54b-5caa73b1b962`
  (MangoHud-Skript) wurde während Smoke-Test versehentlich mit
  Platzhalter überschrieben. Wiederhergestellt aus Backup in
  `/home/dirk/scripts/5-tipps-linux-gaming.md` (283 Zeilen, 10496
  Zeichen). **Lehre**: vor Code-Tests an einer Live-DB ein
  DB-Snapshot in `.bak` anlegen.
- **🔄 Archiv-Skripte re-migriert**: bei Drag&Drop-Smoke-Tests
  wurden die 3 Archiv-Skripte versehentlich nach `scripts` zurück-
  gemoved. Re-Migration manuell durchgeführt.

### Planned
- v0.11: Markdown body inside research-result modal gets progress visualisation
  (per-phase timeline) — see `nix_comment` for the Vidi hand-off format.
- v0.11: OpenClaw research progress via webhook — replace the current
  `tail -F`-on-stderr hack (contentix spawns OpenClaw and parses the
  sub-process's stderr in real time) with a proper webhook callback
  from Vidi into contentix. Cleaner logs, no shell tricks, no race
  between stderr-buffering and polling.
  (The frontend polling of `GET /api/research/:jobId` shipped in
  v0.10.0 — that's done. This is about the *progress-source*.)
- v0.11: `script_folders` table — proper canonical folder list with
  parent/position, instead of free-form string. Will require migration.
- v0.11: Cleanup pass on remaining `position`-field dead code (never written
  by any UI flow; candidate for removal before 0.11).

## [0.11.0] — 2026-06-16

### Added
- **📚 Bibliothek-Redesign (Hero + 2×3-Grids)**: the video library
  is now a curated, personal overview instead of two long list-views.
  New structure:
  - **Hero-Spot** (top): the newest published video with large thumbnail,
    title, category, hook, and meta-row.
  - **📅 Letzte 6** (left grid): chronological order, skip Hero.
  - **🏆 Evergreens** (right grid): top 6 by lifetime views.
  - **🌶️ Hook-Toggle** (top right): 3 modes — `Alle` (default),
    `Stats` (no Nix), `Aus`. Persisted in `localStorage`.
- **Hook-System (3 layers)**: each slot gets a one-liner hook auto-generated
  from three layers (50 % stats, 30 % performance, 20 % Nix-comment). The
  Nix-comments are persona-driven observations — observational, not advisory.
- **Real video thumbnails**: `thumbnail_url` from the API is rendered as
  `<img>` with `onerror` fallback to the gradient+icon placeholder.
  Pre-fix the cards inherited `opacity: 0.7` from the placeholder
  variant, making real thumbs look dim — that specificity bug is fixed.
- **Card hover interaction**: rest state `opacity: 0.7`, hover state
  `opacity: 1.0` plus a soft `scale(1.08) + brightness/saturate` boost
  on the image, a centred play-icon overlay, and a violet title colour.
  Quiet by default, expressive on intent.
- **Footer link** „Alle N Videos anzeigen →" surfaces the total count.

### Changed
- **`bibliothek.js`**: full rewrite as `loadBibliothek()` + `renderBibliothek()`,
  with hook-style toggle and view-switch hook.
- **`index.html`**: Bibliothek view-panel re-structures into Hero + Grids
  (no more 2×10 list-views).
- **`styles.css`**: appended ~290 lines for Hero, Grids, Cards, Hook-Toggle,
  Thumbnail states, Footer. No removals, additive only.

### Spec & Mockup
- `docs/bibliothek-redesign.md` — design doc, hook schema, evergreen
  logic, file-by-file change list, open questions, timeline.
- `mockup/bibliothek-v2.html` — static HTML mockup with 13 fake
  videos for visual review before implementation. Captures the final
  layout, hook style, and 3-way toggle.

## [0.10.2] — 2026-06-11

### Added
- **📊 Watchtime in the sidebar**: a new `/api/vidiq/watchtime` endpoint
  pulls `estimatedMinutesWatched` (28-day rolling window) from
  `vidiq_channel_analytics` and caches it for 6 h. The sidebar's
  "⏱ Watch" badge and the channel-stats widget's "Std. Watchtime"
  row now show real values instead of "0". Costs 5 vidIQ credits on
  a cache miss, 0 on a hit.
- **Watchtime as Step 6 of the vidIQ refresh**: the manual refresh
  button now also pulls watchtime so the sidebar stays fresh after
  a single click.

### Fixed
- `runVidiqRefresh` was clobbering the watchtime sidecar key when it
  re-saved the channel-stats blob. The save now merges with existing
  data so `_watchtime` (and any future sidecar keys) survive a
  refresh.
- **Sub-progress updates in the Vidi-research flow**: `research_jobs.progress_message`
  is updated in place while Vidi runs. Frontend polling shows the live phase
  in the toast (e.g. "🔍 Recherche läuft… (40s · 2 Schritte)").
- **Tool-call pattern matching**: with `--verbose on`, stderr is parsed for
  tool calls and mapped to human-language phases (`vidiq_keyword_research`
  → "🔍 Recherche Keywords…", `vidiq_outliers` → "🔥 Suche Outlier-Videos…",
  `write` → "✏️ Schreibe Skript…", etc.).
- **Elapsed-time fallback**: every 20 s a generic update fires even when no
  tool calls were detected, so the frontend always sees at least one
  progress update per polling tick.
- **Phase history in the result**: completed jobs store a `phases` array
  plus `elapsedSec` in the `result` field for later analysis.

### Changed
- `runResearchJob`: `exec` → `spawn` (stream instead of buffer), enabling
  real-time stderr reads.
- `runResearchJob`: the openclaw call now passes `--verbose on` so tool
  calls are visible in the log.
- Frontend `triggerNixResearch` → `pollResearchJob`: the toast text is
  updated in place on every progress update — no new popup per tick.
- `runResearchJob` now calls `saveDB()` after every mutation (was a bug —
  updates stayed in memory, GET requests saw stale data).

### Fixed
- Pre-spawn cancel check: before calling openclaw, the job's `cancelled`
  status is checked to avoid spawning a Vidi run that would be discarded
  immediately.
- Service crash on the first cancel check: `run()` with a callback was
  breaking — replaced with `getAll()`.

## [0.10.1] — 2026-06-11

### Added
- **Markdown rendering in the Vidi-research modal**: reports are now
  rendered with `marked.js` + `DOMPurify` (XSS-safe). Headings, lists,
  tables, code blocks, blockquotes and links all work.
- **Dark-theme support** for the markdown body (tables, headings,
  blockquotes, hr).

### Changed
- Vidi-report modal: `<pre>` replaced with `<div class="markdown-body">`.
  Monospace styles on the report content replaced with the markdown
  default styles.
- Frontend lib list: `dompurify@3.0.6` added to `index.html` (CDN).

### Removed
- `.research-report` CSS class (was for `<pre>` styling, now superseded
  by `.markdown-body`).

## [0.10.0] — 2026-06-11

### Added
- **🔭 1-click Nix-research in the Kanban board**: a 'Nix' action button
  on every card triggers Vidi 🔭 directly from the browser. End-to-end:
  Contentix → OpenClaw → Vidi → script push → result modal.
- **`research_jobs` table**: tracking for Vidi/Nix spawn jobs (`job_id`,
  `video_id`, `agent_id`, `status`, `progress_message`, `result`, `error`,
  `started_at`, `finished_at`) + indices on `video_id` and `status`.
- **REST endpoints**:
  - `POST /api/research/:videoId` — spawn Vidi asynchronously, body
    `{ agent?, brief? }`, response `{ jobId, status: 'pending' }`. **Cooldown**:
    returns 409 if a job is already running for this video.
  - `GET /api/research/:jobId` — polling endpoint for the frontend (status
    + result + job meta).
  - `GET /api/research?videoId=&status=` — job list with filters.
  - `DELETE /api/research/:jobId` — **cancel** for running jobs (sets
    status to `cancelled`).
- **🔭 button in the card markup** (`kanban.js`): only visible on
  sensible statuses (planned/research/script), action handler in
  `triggerNixResearch()`.
- **Client-side cooldown**: `_runningResearchJobs` Set prevents accidental
  double-triggers in the frontend.
- **Polling pattern**: 2 s interval, 5 min timeout, persistent toast while
  Vidi runs, result modal with job meta and report text.
- **ESC handler in the modal**: Escape closes the result modal (matches
  other app modals).
- **Global JSON error handler**: broken JSON body → clean 400 with
  `{"error":"Invalid JSON body"}` instead of an HTML stacktrace.
- **`showConfirm()` / `hideToast()` in `utils.js`**: promise-based confirm
  dialogs, toast API extended (durationMs=0 = persistent).
- **Status-aware `buildVidiBrief()`**: generates different brief templates
  per `video.status` (planned = first research, research = continue,
  script = v2, recording = revision, done = post-pro, published = follow-up).

### Fixed
- Double-trigger protection (backend + frontend): no more accidental
  double vidIQ-credit burns.
- Modal report renders correctly (app-modal pattern with backdrop, box
  and shadow).
- Cancel endpoint exists — users don't have to wait 5 min for the timeout.
- DB indices on `research_jobs.video_id` and `status` (performance at
  scale).

### Known Limitations
- `result.text` for cancelled jobs is not yet preserved in the polling
  response (we save it but don't return it through the GET endpoint).
- `DELETE /api/research/:jobId` marks the job as cancelled, but cannot
  directly terminate a running openclaw spawn (no PID tracking). The job
  remains visible as `cancelled` until Vidi's final return.

## [0.10.0-alpha] — 2026-06-11

(Initial alpha, superseded by v0.10.0 same day with bugfixes.)

### Added
- **🔭 1-click Nix-research in the Kanban board**: a 'Nix' action button
  on every card triggers Vidi 🔭 directly from the browser.
- **`research_jobs` table**: tracking for Vidi/Nix spawn jobs.
- **REST endpoints**:
  - `POST /api/research/:videoId` — spawn Vidi asynchronously.
  - `GET /api/research/:jobId` — polling endpoint for the frontend.
  - `GET /api/research?videoId=&status=` — job list with filters.
- **Polling pattern**: 2 s interval, 5 min timeout, persistent toast.
- **`showConfirm()` / `hideToast()` in `utils.js`**: promise-based confirm
  dialogs, toast API extended.

### Known Limitations
- Static 'Spawning…' progress (no sub-progress updates).
- Modal report is text-only (no markdown rendering, no tables).
- No cooldown against accidental double-clicks.
- Brief is auto-generated from video data; custom brief per body only
  works for manual API calls.

## [0.9.9] — 2026-06-11

### Added
- **📜 History view (HIST v1.0)**: dedicated view listing all archived
  videos and scripts (`GET /api/history`, `POST /api/videos/:id/archive`,
  `POST /api/videos/:id/restore`, `POST /api/scripts/:id/restore`). Soft
  archive instead of hard DELETE — audit trail for deleted content.
- **🐧 Nix-owner column** (`videos.owner`): migration adds
  `owner TEXT DEFAULT 'dirk'`. Allows multiple agent identities (Nix,
  Vidi, Dirk) per video card in the future.
- **`--text-on-dark-secondary` token** (per theme): a new design token for
  secondary text on dark surfaces (e.g. sidebar). The previous
  `--text-secondary` was designed for light backgrounds and disappeared
  on dark. The new token is defined per-theme at ~78 % brightness of
  `--text-on-dark`.
- **🐛 Bugfix: `/api/scripts/folders` route order**: the static route
  was being caught by `/api/scripts/:id` because it was defined after
  it. Moved + comment added so this doesn't happen again.
- **🧹 Cleanup: `frontend/kanban.js.bak` removed** — 7 weeks old, dead
  code from before the sidebar rework.

### Changed
- **Sidebar spacing between channel name and next-video widget**: 16 px
  extra `margin-top` on `.next-video-widget` when it follows the channel
  name. Other sidebar spacings (widget → "Navigation" heading → nav items)
  remain unchanged.
- **Sidebar text uses `--text-on-dark-secondary`**: tagline, stat labels,
  vidiq status and footer all switched to the new token. Opacity bumped
  to 1 where it was 0.85 because the new colours are already desaturated
  appropriately.
- **Version consistency**: `package.json` bumped to `0.9.9` (was
  drifting behind `/api/health` and `npm` reporting).

## [0.9.8] — 2026-06-09

### Added
- **🖨️ Script print view** in the script editor: a new "🖨️ Drucken"
  button in the editor footer opens a formatted print view of the
  current script.
  - Dedicated print layout: header with title, date, word count and
    linked video (if any) · rendered markdown body in Georgia serif
    12 pt · footer with "Contentix · Title".
  - Code blocks, blockquotes, headings get typographic
    `page-break`/`page-break-inside` rules for clean page breaks.
  - Implemented via a **hidden iframe** (instead of `window.open()`) —
    bypasses popup blockers in Vivaldi/Chrome and preserves the user
    gesture token for `window.print()` reliably.
  - Inline CSS in the iframe (no cross-origin stylesheet lookup).
- **`@media print` stylesheet** in `styles.css`: hides sidebar/toolbar/
  editor-footer/textarea/list-panel when Ctrl+P is pressed in the
  script editor — only the rendered markdown is printed.

## [0.9.5] — 2026-06-03

### Changed
- **Sidebar layout**: "Nächstes Video" widget moved to the top of the
  action zone (directly below channel name). Stats badges and vidIQ
  button now form a separate "data zone" at the bottom.
- **Sidebar colour contrast**: strengthened stat-badge backgrounds
  (rgba 0.12 → 0.18 / border 0.2 → 0.32), nav-link active state with
  violet left border, increased font-weight on footer/vidiq-button,
  higher opacity on tagline and footer for readability.
- **Theme-aware violet variables**: replaced all hardcoded
  `rgba(124, 92, 191, ...)` and `#7c5cbf` references with
  `color-mix(in srgb, var(--nix-violet) X%, transparent)` or
  `var(--nix-violet)`. Stat badges, navigation active state, refresh
  button, modal box-shadow etc. now follow the active theme's accent
  colour.
- **Sidebar spacing**: reduced `> * + *` margin from 32 px to 24 px for
  tighter visual grouping.

### Added
- **Keyboard shortcuts (phase 1)**: power-user features for faster
  workflow
  - `+` or `n` — new card in active column (workflow view only)
  - `1`–`5` — set status directly in the card modal
  - `Cmd/Ctrl + K` — command palette: live search across all card
    titles, tags and notes
  - `Cmd/Ctrl + Enter` — save form (works from any field, including
    the notes textarea)
  - `?` — open keyboard shortcuts help overlay
  - `Esc` — close any open modal/palette/help
- **Command palette** (`#commandPalette`): top-of-screen search, arrow
  keys to navigate, Enter to open, click on result, hover to highlight.
- **Keyboard shortcuts help overlay** (`#shortcutsHelp`): grouped
  display with kbd-styled keys, click backdrop or X to close.
- **`isTypingInField(e)`** utility in `utils.js`: detects input/textarea/
  contenteditable so shortcuts don't fire while typing.
- **`showToast()`** utility in `utils.js`: transient feedback (used by
  shortcuts to confirm actions).

### Fixed
- **`Cmd/Ctrl + Enter` from notes textarea** no longer inserts a literal
  newline — it now triggers the form save.

## [0.9.3] — 2026-06-03

### Added
- **Auto-focus first input field in modals** + **selected-text-on-focus**
  for text inputs: one keystroke replaces existing titles for quick
  edits.
- **Initial git commit** (commit `6cb9cf0`): 30 files, 9 527 lines, the
  entire v0.9.1 codebase finally under version control.
- **Interactive status pipeline in edit mode**: clicking a step in the
  5-stage pipeline now updates the video's status in both edit and
  new-card modes.
- **Hover affordance** on pipeline steps: pointer cursor, slight
  Y-translate on hover, dot scales up.

### Changed
- **README.md**: status pipeline table documents the 6 DB status values
  (`planned | research | script | recording | done | published`) and the
  column mapping.
- **AGENTS.md / SPEC.md**: schema updated to include all 6 status
  values.
- **`frontend/kanban.js`**: extracted `setupStatusPipeline(activeIdx)`
  helper, removed ~40 lines of duplicate code.

## [0.9.1] — 2026-05-29

### Added
- **vidIQ refresh (async)**: `POST /api/vidiq/refresh` returns 202
  immediately with a `jobId`; the actual refresh runs in the background
  via `setImmediate`. Clients poll
  `GET /api/vidiq/refresh/status/:jobId` for progress (0–X/Y).
- `vidiq_refresh_jobs` table with migration for existing DBs.
- `runVidiqRefresh(jobId)` extracted as a standalone async function.

### Added (Frontend)
- **Bibliothek inline**: extracted from iframe寄生 to an inline view —
  `loadBibliothek()` is called directly, no iframe reload.
- `--cal-header-fg` theme variable: per-theme accent colour for calendar
  weekday headers (Mo Di Mi …).
- `--bg-cal-header` theme variable: per-theme background colour for
  week-view header bar.

### Changed (Frontend)
- `calendar-week-header` now uses `var(--bg-cal-header)` instead of
  hardcoded `#2a2040`.
- `calendar-week-header__day` now uses `var(--cal-header-fg)` instead
  of hardcoded violet.
- `.calendar-event--planned` text/border → `var(--text-secondary)` /
  `var(--warning)`.
- `.week-bucket-row__label` colour → `var(--nix-violet)`.

### Fixed (Frontend)
- Removed spurious `</div>` after `bibliothekView` (was breaking CSS
  grid layout — all non-sidebar views invisible).
- `.main` CSS: added explicit `grid-row: 1` and `height: 100%` to fix
  view-panel positioning.
- `.view-panel` flex rules added for consistent column layout.
- `vidiqCancelToken` no longer cleared in `finally` block (was killing
  the poll loop early).
- `calendar.js` video-stats route: data field correction for vidIQ API
  response.

### Security
- All hardcoded colour values replaced with CSS variables (magic
  numbers cleaned up).

## [0.9.0] — 2026-05-29

### Added
- Seasonal theme system: Nix Violet (default), Frühling, Sommer, Herbst,
  Winter.
- Theme switcher in Settings with cookie persistence.
- Next Video Widget urgency animation (4 states based on days to
  publish).
- Copyright footer + version badge in sidebar.
- Weekends highlighted in calendar month view (darker background).
- Month view as default calendar view.
- Delete button in card detail modal (hidden for vidIQ-synced entries).

### Changed
- Sidebar layout: uniform 32 px gaps, better spacing between sections.
- Calendar month view now scrollable when many entries.
- Default calendar view switched from Week to Month.

### Fixed
- vidIQ-synced entries no longer show delete button.
- Sidebar section spacing cleaned up.
- Inline margin styles replaced with CSS.

## [0.1.0] — 2026-04-17

### Added
- Initial release: YouTube Content Planner.
- Kanban board with 5 status columns.
- Calendar view (Month + Week).
- vidIQ channel stats integration.
- Script management.
- Bibliothek view (iframe).
- "Das Logbuch" design system.

---

*By Nix 🐧 & Dirk, 2026. "If it ain't in the changelog, it didn't happen."*

