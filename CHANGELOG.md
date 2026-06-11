# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] — 2026-06-11

### Added
- **🔭 1-Klick-Nix-Research im Kanban-Board**: 'Nix'-Action-Button auf jeder Card triggert Vidi 🔭 direkt aus dem Browser. End-to-End: Contentix → OpenClaw → Vidi → Skript-Push → Result-Modal.
- **`research_jobs`-Tabelle**: Tracking für Vidi/Nix-Spawn-Jobs (job_id, video_id, agent_id, status, progress_message, result, error, started/finished_at) + Indices auf video_id und status.
- **REST-Endpoints**:
  - `POST /api/research/:videoId` — Spawn Vidi asynchron, Body `{ agent?, brief? }`, Response `{ jobId, status: 'pending' }`. **Cooldown**: 409 wenn Job schon läuft.
  - `GET /api/research/:jobId` — Polling-Endpoint für Frontend (Status + Result + Job-Meta)
  - `GET /api/research?videoId=&status=` — Job-Liste mit Filtern
  - `DELETE /api/research/:jobId` — **Cancel** für laufende Jobs (Status → cancelled)
- **🔭 Button im Card-Markup** (`kanban.js`): nur sichtbar auf sinnvollen Status (planned/research/script), Action-Handler in `triggerNixResearch()`.
- **Client-Cooldown**: `_runningResearchJobs` Set verhindert Doppel-Trigger im Frontend.
- **Polling-Pattern**: 2s-Intervall, 5-Min-Timeout, persistent Toast während Vidi läuft, Result-Modal mit Job-Meta und Report-Text.
- **ESC-Handler im Modal**: Escape-Taste schließt das Result-Modal (wie andere App-Modals).
- **Globaler JSON-Error-Handler**: kaputtes JSON-Body → sauberes 400 mit `{"error":"Invalid JSON body"}` statt HTML-Stacktrace.
- **`showConfirm()` / `hideToast()` in utils.js**: Promise-basierte Confirm-Dialogs, Toast-API erweitert (durationMs=0 = persistent).
- **Status-aware buildVidiBrief()**: generiert unterschiedliche Brief-Templates je nach video.status (planned=erste Recherche, research=weiter, script=V2, recording=Revision, done=PostPro, published=Follow-up).

### Fixed
- Doppel-Trigger-Schutz (Backend + Frontend): kein versehentliches 2x vidIQ-Credit-Verbrennen mehr.
- Modal-Report rendert jetzt korrekt (App-Modal-Pattern mit Backdrop, Box, Schatten).
- Cancel-Endpoint vorhanden — User muss nicht 5 Min auf Timeout warten.
- DB-Indices auf research_jobs.video_id und status (Performance bei Skalierung).

### Known Limitations
- Progress-Anzeige zeigt nur statisches 'Spawning…' während Vidi läuft (kein Sub-Progress-Update von Vidi selbst).
- Modal-Report ist text-only (kein Markdown-Rendering, keine Tabellen).
- DELETE /api/research/:jobId markiert Job als cancelled, kann aber den laufenden OpenClaw-Spawn nicht direkt terminieren (kein PID-Tracking). Job bleibt bis zum Vidi-Final-Return sichtbar als 'cancelled'.

## [0.10.0-alpha] — 2026-06-11

(Initial alpha, superseded by v0.10.0 same day with bugfixes.)

### Added
- **🔭 1-Klick-Nix-Research im Kanban-Board**: 'Nix'-Action-Button auf jeder Card triggert Vidi 🔭 direkt aus dem Browser. End-to-End: Contentix → OpenClaw → Vidi → Skript-Push → Result-Modal.
- **`research_jobs`-Tabelle**: Tracking für Vidi/Nix-Spawn-Jobs (job_id, video_id, agent_id, status, progress_message, result, error, started/finished_at).
- **REST-Endpoints**:
  - `POST /api/research/:videoId` — Spawn Vidi asynchron, Body `{ agent?, brief? }`, Response `{ jobId, status: 'pending' }`
  - `GET /api/research/:jobId` — Polling-Endpoint für Frontend (Status + Result + Job-Meta)
  - `GET /api/research?videoId=&status=` — Job-Liste mit Filtern
- **🔭 Button im Card-Markup** (`kanban.js`): hover-reveal auf jeder Card, Action-Handler in `triggerNixResearch()`.
- **Polling-Pattern**: 2s-Intervall, 5-Min-Timeout, persistent Toast während Vidi läuft, Result-Modal mit Job-Meta und Report-Text.
- **`showConfirm()` / `hideToast()` in utils.js**: Promise-basierte Confirm-Dialogs, Toast-API erweitert (durationMs=0 = persistent).

### Known Limitations
- Progress-Anzeige zeigt nur statisches 'Spawning…' während Vidi läuft (kein Sub-Progress-Update von Vidi selbst).
- Modal-Report ist text-only (kein Markdown-Rendering, keine Tabellen).
- Kein Cooldown gegen versehentliche Doppel-Klicks (Vidi-Trigger ist sofortig).
- Brief wird aus Video-Daten auto-generiert; Custom-Brief per Body nur für manuelle API-Calls.

## [0.9.9] — 2026-06-11

### Added
- **📜 History-Funktion** (HIST v1.0): Eigene History-View mit Liste aller archivierten Videos und Skripte (`GET /api/history`, `POST /api/videos/:id/archive`, `POST /api/videos/:id/restore`, `POST /api/scripts/:id/restore`). Soft-Archive statt hartem DELETE — Audit-Trail für gelöschte Inhalte.
- **🐧 Nix-Owner-Spalte** (`videos.owner`): Migration ergänzt `owner TEXT DEFAULT 'dirk'`. Erlaubt künftig mehrfache Agent-Identitäten (Nix, Vidi, Dirk) pro Video-Card.
- **`--text-on-dark-secondary` token** (per-theme): A new design token for secondary text on dark surfaces (e.g. sidebar). The previous `--text-secondary` was designed for light backgrounds and disappeared on dark. The new token is defined per-theme at ~78% brightness of `--text-on-dark` (violet, green, gold, warmgray, iceblue depending on theme).
- **🐛 Bugfix: `/api/scripts/folders` Route-Reihenfolge**: Die statische Route wurde von `/api/scripts/:id` abgefangen, weil sie danach definiert war. Verschiebt + Kommentar ergänzt, damit dieser Fehler nicht wiederkehrt.
- **🧹 Cleanup: `frontend/kanban.js.bak` entfernt** — 7 Wochen alt, vor Sidebar-Rework, Dead Code.

### Changed
- **Sidebar spacing between channel name and next-video widget**: added 16px extra `margin-top` on `.next-video-widget` when it follows the channel name. They were too tight, now have a bit more breathing room. Other sidebar spacings (widget → "Navigation" heading → nav items) remain unchanged.
- **Sidebar text uses `--text-on-dark-secondary`**: tagline, stat labels, vidiq status and footer all switched to the new token. Opacity bumped to 1 where it was 0.85 because the new colors are already desaturated appropriately.
- **Versionskonsistenz**: `package.json` auf `0.9.9` angehoben (lief drifteich hinterher zu `/api/health` und `npm`-Reporting).

## [0.9.8] — 2026-06-09

### Added
- **🖨️ Skript-Druckansicht** im Skript-Editor: Neuer "🖨️ Drucken"-Button im Editor-Footer öffnet eine formatierte Druckansicht des aktuellen Skripts.
  - Eigenes Print-Layout: Header mit Titel, Datum, Wortzahl und ggf. verlinktem Video · gerenderter Markdown-Body in Georgia Serif 12pt · Footer mit "Contentix · Titel"
  - Code-Blöcke, Blockquotes, Headings mit typografischen `page-break`/`page-break-inside`-Regeln für saubere Seitenumbrüche
  - Implementiert per **verstecktes iframe** (statt `window.open()`), umgeht Popup-Blocker in Vivaldi/Chrome und erhält den User-Gesture-Token für `window.print()` zuverlässig
  - Inline-CSS im iframe (kein Cross-Origin-Stylesheet-Lookup nötig)
- **`@media print` Stylesheet** in `styles.css`: Versteckt Sidebar/Toolbar/Editor-Footer/Textarea/List-Panel, wenn man im Skript-Editor Ctrl+P drückt — nur das gerenderte Markdown wird gedruckt.

## [Unreleased]

## [0.9.5] — 2026-06-03

### Changed
- **Sidebar layout**: "Nächstes Video" widget moved to the top of the action zone (directly below channel name). Stats badges and vidIQ button now form a separate "data zone" at the bottom.
- **Sidebar color contrast**: Strengthened stat-badge backgrounds (rgba 0.12 → 0.18 / border 0.2 → 0.32), nav-link active state with violet left border, increased font-weight on footer/vidiq-button, higher opacity on tagline and footer for readability.
- **Theme-aware violet variables**: Replaced all hardcoded `rgba(124, 92, 191, ...)` and `#7c5cbf` references with `color-mix(in srgb, var(--nix-violet) X%, transparent)` or `var(--nix-violet)`. Stat badges, navigation active state, refresh button, modal box-shadow etc. now follow the active theme's accent color (violet, green, gold, orange, or ice blue depending on season).
- **Sidebar spacing**: Reduced `> * + *` margin from 32px to 24px for tighter visual grouping.

### Added
- **Keyboard shortcuts (Phase 1)**: Power-user features for faster workflow
  - `+` or `n` — New card in active column (workflow view only)
  - `1`-`5` — Set status directly in the card modal (Ideen / Recherche / Skript / Recording / Hochgeladen)
  - `Cmd/Ctrl + K` — Command palette: live search across all card titles, tags, and notes
  - `Cmd/Ctrl + Enter` — Save form (works from any field, including the notes textarea)
  - `?` — Open keyboard shortcuts help overlay
  - `Esc` — Close any open modal/palette/help (extended to cover palette + help too)
- **Command palette** (`#commandPalette`): Top-of-screen search, Arrow keys to navigate, Enter to open, click on result, hover to highlight
- **Keyboard shortcuts help overlay** (`#shortcutsHelp`): Beautiful grouped display with kbd-styled keys, click backdrop or X to close
- **`isTypingInField(e)`** utility in utils.js: detects input/textarea/contenteditable so shortcuts don't fire while typing
- **`showToast()`** utility in utils.js: transient feedback (used by shortcuts to confirm actions)

### Fixed
- **`Cmd/Ctrl + Enter` from notes textarea** no longer inserts a literal newline — it now triggers the form save. Formatted save from anywhere in the card modal.

## [0.9.3] — 2026-06-03

### Added
- **Auto-focus first input field in modals** + **selected-text-on-focus** for text inputs: One keystroke replaces existing titles for quick edits.
- **Initial git commit** (commit 6cb9cf0): 30 files, 9,527 lines, the entire v0.9.1 codebase finally under version control.
- **Interactive status pipeline in edit mode**: Clicking a step in the 5-stage pipeline now updates the video's status in both edit and new-card modes.
- **Hover affordance** on pipeline steps: pointer cursor, slight Y-translate on hover, dot scales up.

### Changed
- **README.md**: Status pipeline table documents the 6 DB status values (`planned | research | script | recording | done | published`) and the column mapping.
- **AGENTS.md / SPEC.md**: Schema updated to include all 6 status values.
- **`frontend/kanban.js`**: Extracted `setupStatusPipeline(activeIdx)` helper, removed ~40 lines of duplicate code.

## [0.9.0] — 2026-05-29

### Added
- Seasonal theme system: Nix Violet (default), Frühling, Sommer, Herbst, Winter
- Theme switcher in Settings with cookie persistence
- Next Video Widget urgency animation (4 states based on days to publish)
- Copyright footer + version badge in sidebar
- Weekends highlighted in calendar month view (darker background)
- Monatsansicht as default calendar view
- Delete button in card detail modal (hidden for vidIQ-synced entries)

### Changed
- Sidebar layout: uniform 32px gaps, better spacing between sections
- Calendar month view now scrollable when many entries
- Default calendar view switched from Week to Month

### Fixed
- vidIQ-synced entries no longer show delete button
- Sidebar section spacing cleaned up
- Inline margin styles replaced with CSS

## [0.1.0] — 2026-04-17

### Added
- Initial release: YouTube Content Planner
- Kanban board with 5 status columns
- Calendar view (Month + Week)
- vidIQ channel stats integration
- Script management
- Bibliothek view (iframe)
- "Das Logbuch" design system

## [0.9.1] — 2026-05-29

### Added
- **vidIQ Refresh (async)**: POST `/api/vidiq/refresh` returns 202 immediately with jobId; actual refresh runs in background via `setImmediate`. Clients poll `GET /api/vidiq/refresh/status/:jobId` for progress (0–X/Y).
- `vidiq_refresh_jobs` table with migration for existing DBs
- `runVidiqRefresh(jobId)` extracted as standalone async function

### Added (Frontend)
- **Bibliothek inline**: extracted from iframe寄生 to inline view — `loadBibliothek()` called directly, no iframe reload
- `--cal-header-fg` theme variable: per-theme accent color for calendar weekday headers (Mo Di Mi …)
- `--bg-cal-header` theme variable: per-theme background color for week-view header bar

### Changed (Frontend)
- `calendar-week-header` now uses `var(--bg-cal-header)` instead of hardcoded `#2a2040`
- `calendar-week-header__day` now uses `var(--cal-header-fg)` instead of hardcoded violet
- `.calendar-event--planned` text/border → `var(--text-secondary)` / `var(--warning)`
- `.week-bucket-row__label` color → `var(--nix-violet)`

### Fixed (Frontend)
- Removed spurious `</div>` after `bibliothekView` (was breaking CSS grid layout — all non-sidebar views invisible)
- `.main` CSS: added explicit `grid-row: 1` and `height: 100%` to fix view-panel positioning
- `.view-panel` flex rules added for consistent column layout
- `vidiqCancelToken` no longer cleared in `finally` block (was killing poll loop early)
- `calendar.js` video-stats route: data field correction for vidIQ API response

### Security
- All hardcoded color values replaced with CSS variables (Magic Numbers cleaned up)


## [0.10.1] - 2026-06-11

### Added
- **Markdown-Rendering im Vidi-Research-Modal**: Reports werden mit `marked.js` + `DOMPurify` als HTML gerendert. Headings, Listen, Tabellen, Code-Blöcke, Blockquotes, Links funktionieren jetzt.
- **Dark-Theme-Support** für Markdown-Body (Tabellen, Headings, Blockquotes, hr).

### Changed
- Vidi-Report-Modal: `<pre>` durch `<div class="markdown-body">` ersetzt. Monospace-Styles auf Markdown-Default-Styles umgestellt.
- Frontend-Lib-Liste: `dompurify@3.0.6` zu index.html hinzugefügt (CDN).

### Removed
- `.research-report`-CSS-Klasse (war für `<pre>`-Style, jetzt ersetzt durch `.markdown-body`).


## [0.10.2] - 2026-06-11

### Added
- **Sub-Progress-Updates im Vidi-Research-Flow**: research_jobs.progress_message wird jetzt während des Vidi-Runs in-place aktualisiert. Frontend-Polling zeigt Live-Phase im Toast (z.B. "🔍 Recherche läuft… (40s · 2 Schritte)").
- **Tool-Call-Pattern-Matching**: --verbose on parsed stderr nach Tool-Calls, mappt sie auf User-Language-Phasen (vidiq_keyword_research → "🔍 Recherche Keywords…", vidiq_outliers → "🔥 Suche Outlier-Videos…", write → "✏️ Schreibe Skript…", etc.).
- **Elapsed-time-Fallback**: alle 20s ein generisches Update, falls keine Tool-Calls erkannt wurden. Garantiert dass das Frontend immer min. alle 20s ein Update sieht.
- **Phasen-History im Result**: done-Jobs speichern `phases`-Array + `elapsedSec` im result-Feld für spätere Analyse.

### Changed
- runResearchJob: `exec` → `spawn` (stream statt buffer), dadurch stderr-Lesen in Echtzeit möglich.
- runResearchJob: openclaw-Aufruf hat jetzt `--verbose on` damit Tool-Calls sichtbar werden.
- Frontend triggerNixResearch → pollResearchJob: Toast-Text wird bei jedem Progress-Update aktualisiert, kein neues Popup.
- runResearchJob: ruft jetzt `saveDB()` nach jeder Mutation auf (war Bug — Updates waren in-memory, nicht auf Disk, GET-Requests sahen veraltete Daten).

### Fixed
- Pre-Spawn-Cancel-Check: vor dem OpenClaw-Spawn wird geprüft ob der Job zwischenzeitlich gecancelt wurde, um unnötige Runs zu vermeiden.
- Service-Crash beim ersten Cancel-Check: `run()` mit Callback gebrochen — durch `getAll()` ersetzt.

