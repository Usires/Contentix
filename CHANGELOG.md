# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

