# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Interactive status pipeline in edit mode**: Clicking a step in the 5-stage pipeline (Ideen → Recherche → Skript → Recording → Hochgeladen) now updates the video's status, in both edit and new-card modes. Previously read-only when editing an existing card.
- **Hover affordance** on pipeline steps: pointer cursor, slight Y-translate on hover, dot scales up. Makes it discoverable that the pipeline is interactive.
- **Initial git commit** (commit 6cb9cf0): 30 files, 9,527 lines, all the v0.9.1 codebase finally under version control. The repo had been staged since April 17 but never committed.

### Changed
- **README.md**: Status pipeline table now documents the 6 DB status values (`planned | research | script | recording | done | published`) and the column mapping. Replaces the outdated 3-value schema.
- **AGENTS.md**: Video Object schema updated to include all 6 status values with semantics and Kanban column mapping.
- **SPEC.md**: `videos.status` SQL comment expanded to document all 6 valid values.
- **`frontend/kanban.js`**: Extracted `setupStatusPipeline(activeIdx)` helper function. Removes ~40 lines of duplicate pipeline code that existed separately in the edit and new-card branches.

### Fixed
- **Status change from edit modal**: Previously, to change a video's status, you had to drag-and-drop it on the board. Now you can also click the pipeline step in the modal. The hidden `form.status` field is updated immediately and saved with the form.

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

