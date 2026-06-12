# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- v0.11: Markdown body inside research-result modal gets progress visualisation
  (per-phase timeline) — see `nix_comment` for the Vidi hand-off format.
- v0.11: OpenClaw research polling surface — contentix polls a webhook on
  progress instead of `tail -F` on stderr. Cleaner logs, no shell tricks.
- v0.11: Cleanup pass on remaining `position`-field dead code (never written
  by any UI flow; candidate for removal before 0.11).

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

