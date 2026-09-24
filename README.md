# Contentix — YouTube Content Planner

*A self-hosted Kanban + Calendar + Script editor for solo YouTube creators, with Youtube API/Analytics based insights baked in.*

By Nix 🐧 & Dirk, 2026. Licensed under [MIT](./LICENSE).

---

## What is it?

Contentix is a single-binary web app for planning YouTube videos end to end:

- 📋 **Kanban board** with a 5-stage status pipeline (ideas → research →
  script → recording → uploaded) plus a separate `published` status for
  videos that are actually live on YouTube.
- 📅 **Calendar view** (Month + Week) with cards positioned by planned
  and published dates.
- ✏️ **Script editor** (JSTree-powered v0.11+): tree-view sidebar with
  5 folders (scripts, Entwürfe, channel, resources, Archiv), drag & drop
  between folders, status icons (⚪🟡🟢📦), live-search, right-click
  context menu, folder icons (📁/📂), single-click toggle, and
  localStorage-persisted state. Markdown preview, link-to-video, archive
  workflow, and a print-friendly view.
- 📚 **Bibliothek** view (v0.11+ curated): Hero-Spot for the newest
  release, two 2×3-grids (Letzte 6 + Evergreens) with real YouTube
  thumbnails, auto-generated hooks (stats / performance / Nix-comment)
  per slot, and a 🌶️ Hooks toggle (Alle / Stats / Aus) for personal
  taste. See `docs/bibliothek-redesign.md` for the design spec.
- 🔭 **Vidi agent** (1-click YouTube research, v0.10+): a button on every
  Kanban card spawns a Vidi research run via OpenClaw, streams
  progress into the UI, and writes the final report into the card.
  Vidi is a separate agent in the same OpenClaw gateway — a scout
  that gathers YouTube channel/video data, not a coach. See
  `docs/vidi-agent.md` for the architecture.
- 🎨 **Seasonal themes** (Nix Violet default + four others) with
  per-theme colour tokens.

**Stack:** Node.js + Express + sql.js (SQLite in-process) — frontend
and backend in a single app. Port `3038`.

**YouTube Data API v3** (via self-hosted MCP server in `mcp-servers/youtube/`):
the primary source for channel and video stats. Free public quota
(10,000 units/day) — no third-party credits required. Cached
aggressively in `app_settings.yt_cache_*` so we don't burn quota
on repeat lookups.

> **Legacy:** older versions integrated with [vidIQ](https://app.vidiq.com/)
> as the primary data source. The legacy `/api/vidiq/*` routes and
> `vidiq_*` DB tables still exist for backwards-compat but require
> `VIDIQ_API_KEY` in `.env`. New code should use the `/api/youtube/*`
> routes. Full deprecation tracked on NixBoard card **VIDIQ** (planned
> removal: 2026-10-31).

---

## Quick Start (Docker)

```bash
git clone https://github.com/Usires/contentix.git
cd contentix
cp .env.example .env
# edit .env and add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (for OAuth)
docker-compose up -d
open http://localhost:3038
```

That's it. The database persists in `./data/`. Stop with
`docker-compose down`, restart with `docker-compose restart`.

---

## Quick Start (Local Node)

If you prefer running it directly (no Docker):

```bash
git clone https://github.com/Usires/contentix.git
cd contentix
cp .env.example .env
# edit .env and add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (for OAuth)
npm install
./start.sh       # → http://localhost:3038
```

`start.sh` is a thin wrapper around `restart.sh` — both are idempotent
and use a PID file under `./contentix.pid`.

## YouTube OAuth (for your own channel & analytics)

Contentix uses the **YouTube Data API v3** with your own OAuth
credentials for everything: channel research, your own uploads,
watchtime, and YouTube Analytics data. There is no third-party
service in the loop — you connect directly to Google's API.

```bash
npm install
npm run oauth:setup          # interactive wizard: prints Google auth URL
npm run oauth:check          # verify the token works
```

Full instructions — including how to do the OAuth dance over an SSH tunnel
if Contentix runs on a remote server — are in [`docs/oauth-setup.md`](./docs/oauth-setup.md).
The setup only needs to be re-run when your refresh token expires or gets
revoked (typically every few months, or never).

For monitoring, the MCP server exposes `GET /health/oauth` (returns `200 OK`
with `status: "healthy"` when the token works, `503 Service Unavailable`
with `status: "expired"` otherwise). Drop this URL into Uptime-Kuma or any
HTTP monitor to get notified before you notice "new videos aren't showing up".

## Tests (Playwright)

A small Playwright suite covers the most visible UI regressions (the
`tests/hero-fallback.spec.js` checks the library hero and its
image-fallback path). Single-user app, so tests run sequentially.

```bash
npm install                  # also pulls @playwright/test
npx playwright install chromium
npm test                     # → 3 tests in tests/hero-fallback.spec.js
```

Add new specs under `tests/` — they auto-pick up via `testDir: './tests'`
in `playwright.config.js`. HTML report goes to `playwright-report/`
(`.gitignore`d).

---

## Environment variables

See [`.env.example`](./.env.example) for the full list. You need
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` if you want OAuth
(your own channel's videos, watchtime, Analytics data). Everything
else is optional and has a sensible default.

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `GOOGLE_CLIENT_ID` | yes, for OAuth | — | See [docs/oauth-setup.md](./docs/oauth-setup.md) |
| `GOOGLE_CLIENT_SECRET` | yes, for OAuth | — | Same as above |
| `PORT` | no | `3038` | HTTP port |
| `DATA_DIR` | no | (next to `index.js`) | Where `contentix.db` lives. Docker sets this to `/app/data`. |
| `LOG_LEVEL` | no | `info` | `info` \| `debug` \| `silent` |
| `OPENCLAW_GATEWAY_URL` | no | — | e.g. `http://localhost:18789` |
| `MCP_PORT` | no | `8190` | Port of the YouTube MCP server (used by `oauth:setup` and `/health/oauth`) |
| `OPENCLAW_GATEWAY_TOKEN` | no | — | From `~/.openclaw/openclaw.json` |
| `VIDIQ_API_KEY` | no (legacy) | — | **Deprecated.** Only needed if you still use the legacy `/api/vidiq/*` routes (will be removed 2026-10-31, see NixBoard **VIDIQ**). New code uses `/api/youtube/*`. |

---

## Architecture

```
contentix/
├── index.js              ← Backend: Express, REST API, YouTube MCP client,
│                            OpenClaw research bridge, sqlite-via-js
├── Dockerfile            ← node:20-alpine, runs as non-root
├── docker-compose.yml    ← Service definition, healthcheck, volumes
├── package.json
├── VERSION               ← Single source of truth (also read by /api/health)
├── contentix.db          ← SQLite (created on first run, gitignored)
├── data/                 ← Mount-point for Docker (contains contentix.db)
├── frontend/
│   ├── index.html        ← HTML structure (sidebar + .main + view-panels)
│   ├── app.js            ← Main router, loadStats, navigation
│   ├── kanban.js         ← Kanban board (drag&drop, card CRUD, 🔭 button)
│   ├── calendar.js       ← Calendar (month + week, card placement)
│   ├── store.js          ← Central state (pub/sub pattern)
│   ├── utils.js          ← escapeHtml, formatNumber, truncate, toast
│   ├── scripts.js        ← Script editor + markdown preview + print
│   ├── history.js        ← History view (archived videos/scripts)
│   ├── effects.js        ← Visual effects (Konami code, etc.)
│   ├── styles.css        ← Global CSS + theme tokens
│   ├── kanban.css        ← Kanban board (5-column grid)
│   ├── calendar.css      ← Calendar layout
│   └── history.css       ← History view
├── restart.sh            ← Smart restart (PID file, port-aware, healthcheck)
├── start.sh              ← Thin wrapper around restart.sh
├── LICENSE
├── README.md
├── CHANGELOG.md
├── MAKINGOF.md           ← How this project came to be
├── SPEC.md               ← Original spec (now historical)
├── AGENTS.md             ← AI agent integration guide
├── UX-BRIEFING.md        ← Design notes
└── HISTORY-SPEC.md       ← History feature spec (HIST v1.0)
```

### Routing

`app.js` → `setupNav()`:

| Sidebar nav | View | Contents |
|-------------|------|----------|
| `data-view="ideas"` | `#ideasView` | Kanban board (`#kanbanBoard`) |
| `data-view="content"` | `#contentView` | Expeditionen + channel stats |
| `data-view="calendar"` | `#calendarView` | Calendar |
| `data-view="settings"` | `#settingsView` | Settings (theme, etc.) |

`#ideasView` contains `<div id="kanbanBoard" class="board">` — the
`class="board"` is critical for the grid layout.

### State management

A single `store.js` module holds the canonical `allCards` array. Both
`kanban.js` and `calendar.js` subscribe to the store — neither keeps
its own copy. Updates are `setAllCards(newCards)` and the store
notifies all listeners. This eliminates the race conditions you get
when two views keep separate references.

### Logging

`LOG_LEVEL` controls verbosity. Defaults to `info` (startup, lifecycle,
errors). `debug` adds every API hit and every spawned sub-process.
`silent` keeps only FATAL errors.

---

## REST API

See [AGENTS.md](./AGENTS.md) for the full reference. Highlights:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Liveness + version |
| `GET` | `/api/videos` | List all videos |
| `POST` | `/api/videos` | Create a video |
| `PUT` | `/api/videos/:id` | Update a video |
| `DELETE` | `/api/videos/:id` | Delete a video |
| `GET` | `/api/scripts` | List all scripts |
| `POST` | `/api/scripts` | Create a script |
| `POST` | `/api/scripts/import` | Import a `.md` file as a script |
| `GET` | `/api/scripts/folders` | List script folders |
| `GET` | `/api/history` | List archived videos |
| `POST` | `/api/youtube/refresh` | Trigger a YouTube Data API refresh (async) |
| `GET` | `/api/youtube/channel-stats` | Cached channel stats |
| `GET` | `/api/youtube/watchtime` | Cached watchtime (28-day window, 6h cache) |
| `POST` | `/api/research/:videoId` | Trigger a Nix research run (v0.10+) |
| `GET` | `/api/research/:jobId` | Poll a research job |
| `DELETE` | `/api/research/:jobId` | Cancel a research job |
| ~~`/api/vidiq/*`~~ | **legacy** | Deprecated `/api/vidiq/*` routes — returns 503 unless `VIDIQ_API_KEY` is set. Removal planned 2026-10-31 (NixBoard **VIDIQ**). |

---

## Database

Single SQLite file via `sql.js` (no native bindings, no compilation).
On startup, `initDB()` either opens the existing `contentix.db` or
creates a fresh schema. All migrations are idempotent — safe to run
on every boot.

### Tables (v0.10.2)

- `videos` — the kanban cards. `status` is one of 6 values:
  `planned | research | script | recording | done | published`.
  See [AGENTS.md](./AGENTS.md#status-field-pipeline) for the full
  pipeline semantics.
- `scripts` — markdown script bodies, optionally linked to a video via
  `video_id`.
- `app_settings.yt_cache_*` — YouTube Data API response cache,
  keyed by `key` + `video_id`/`channel_id`. Saves YouTube API
  quota (10,000 units/day).
- `yt_cache`, `yt_video_cache` — older YouTube cache tables (also
  backed by `app_settings` since v0.13.1).
- `vidiq_cache`, `vidiq_video_cache` — **legacy** vidIQ response
  cache. Keyed by channel/video id. Will be removed 2026-10-31
  (NixBoard **VIDIQ**).
- `vidiq_refresh_jobs` — **legacy** async vidIQ-refresh bookkeeping.
  Will be removed 2026-10-31 (NixBoard **VIDIQ**).
- `research_jobs` — async Nix/Vidi research bookkeeping (v0.10+).
- `research_jobs` — async Nix/Vidi research bookkeeping (v0.10+).

---

## YouTube Data API integration

The backend talks to YouTube through a self-hosted MCP server
(`mcp-servers/youtube/`, exposed on `MCP_PORT` = 8190). The MCP
client lives in `index.js` (search for `youtube_api` and
`makeMcpCall`). Responses are cached aggressively in `app_settings`
so we don't burn the YouTube Data API quota (10,000 units/day).

**Quota-saving rules:**

- Channel stats: cached for 6 hours by default (`yt.cache.channelTtlHours`).
- Video stats: cached for 24 hours by default (`yt.cache.videoTtlHours`).
- The `POST /api/youtube/refresh` endpoint forces a full refresh of
  cached data (counts against quota).

OAuth tokens for **your own channel's** data (uploads, watchtime,
YouTube Analytics) live in `app_settings` (encrypted at rest since
v0.13.1). Refresh them with `npm run oauth:setup`.

---

## Legacy vidIQ integration (deprecated)

> **Status:** deprecated as of v0.13.0. Removal planned 2026-10-31.
> New code uses the YouTube Data API (above). See NixBoard **VIDIQ**
> for the migration plan.

When `VIDIQ_API_KEY` is set, the legacy `/api/vidiq/*` routes
forward to the self-hosted YouTube MCP under the hood. They keep
the old response shape for backwards-compat with older clients.
Without `VIDIQ_API_KEY`, those routes return 503.

---

## Vidi agent integration (v0.10+)

The 🔭 button on every Kanban card calls
`POST /api/research/:videoId`, which spawns the **Vidi** subagent via
[OpenClaw](https://github.com/openclaw/openclaw) and streams the
result back. The frontend polls every 2 s and updates a persistent
toast with live progress (e.g. "🔍 Recherche läuft… (40 s · 2
Schritte)").

The result opens in a modal with full markdown rendering (via
`marked.js` + `DOMPurify` for XSS safety). The Vidi run is also
self-aware: it checks whether a script already exists for the video
and skips a duplicate push.

**Vidi is a scout, not a coach.** It gathers YouTube channel and
video data via the self-hosted YouTube MCP and quotes sources.
Strategic recommendations come from Nix (the main agent).
See `docs/vidi-agent.md` for the full architecture, role split,
cost model, and operational checklist.

For this to work, set `OPENCLAW_GATEWAY_URL` and
`OPENCLAW_GATEWAY_TOKEN` in your `.env`. If you don't, the 🔭 button
gracefully responds with a clear error message.

---

## Vidi 2.0 — proactive topic discovery (optional add-on)

The original Vidi is a **pull** service: you click a button, it
researches one video. **Vidi 2.0** is a **push** service: it
watches LILAC + YouTube trending in the background, picks topics
that fit your channel, and pushes them into a floating
**Vidi-Inbox** panel in the Kanban view.

The default Contentix install does **not** include Vidi 2.0 — it
runs as a separate FastAPI process on port 8191, talks to
Contentix via `/api/vidi/*`, and uses local Ollama models
(qwen3.5 for bulk classification, gemma4:12b for reasoning,
ornith-1.5:9b for synthesis) to keep everything private.

### Why two services instead of one?

- **Independent deploys.** Update Contentix without restarting
  Vidi; roll back Vidi without touching Contentix. Each has its
  own git tag.
- **Independent resources.** Vidi's Ollama calls (slow, 5–30 s
  per reasoning call) don't block Contentix's UI requests.
- **Independent failures.** Vidi down ≠ Contentix down. The
  frontend detects via `GET /api/vidi/status` and gracefully
  hides the Vidi-Inbox panel if the service is unreachable.

### Quick start

```bash
# In a separate terminal, from the Contentix repo root:
./venv/bin/python3 vidi2/src/service.py

# Or via Docker (recommended for production):
docker-compose -f docker-compose.vidi.yml up -d

# Verify it's running:
curl -s http://localhost:8191/status | jq
```

### Triggering a discovery run

```bash
# Manual trigger (also runs automatically via cron at 09:00):
curl -X POST http://localhost:8191/run/discovery \
  -H "Content-Type: application/json" \
  -d '{"maxItems": 5}'
```

Suggestions appear in the Vidi-Inbox panel as floating cards.
Click `✓ Approve` to create a Kanban card in the research lane,
or `✗ Reject` to archive it.

### Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   Contentix UI      │         │   Vidi 2.0 Service  │
│   (Kanban view)     │◄────────│   (FastAPI :8191)   │
│                     │ /api/   │                     │
│   Vidi-Inbox panel  │  vidi/* │   Pull→Classify→    │
└─────────────────────┘         │   Trend→Synthesize  │
                                │        │            │
                                │        ▼            │
                                │   Ollama :12434     │
                                │   (qwen3.5,         │
                                │    gemma4:12b,      │
                                │    ornith-1.5:9b)   │
                                └─────────────────────┘
```

### Environment variables (Vidi side)

| Variable | Default | What it controls |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:12434` | Ollama endpoint |
| `OLLAMA_PRIMARY_MODEL` | `qwen3.5:latest` | Bulk classifier |
| `OLLAMA_REASONING_MODEL` | `gemma4:12b` | Trend + synth reasoning |
| `OLLAMA_AGENT_MODEL` | `ornith-1.5:9b` | Synthesis-style output |
| `DISCOVERY_CRON` | `0 9 * * *` | When to auto-trigger (cron expression) |
| `DISCOVERY_ENABLED` | `true` | Disable to skip cron-triggered runs |
| `CLOUD_FALLBACK_ENABLED` | `false` | Allow M3 cloud as fallback for synthesis |
| `LILAC_NEWSLETTER_URL` | `http://localhost:8182/newsletter/lilac-archive.json` | Source for LILAC archive |

Full spec, prompts, and reasoning: see `vidi2/SPEC.md`.

---

## Troubleshooting

### "EADDRINUSE" on startup

Another process is holding port `3038`. Run `./restart.sh` (it kills
the port-holder automatically) or `lsof -i :3038` / `ss -tlnp
sport = :3038` to find it manually.

### YouTube channel stats show 0

You haven't triggered a refresh yet, or the YouTube Data API quota
(10,000 units/day) is exhausted. Hit the "YouTube refresh" button in
the sidebar to force a re-fetch. If you're using a fresh OAuth
token, run `npm run oauth:check` first to verify the token works.

> **Legacy vidIQ users:** if your `.env` still has `VIDIQ_API_KEY`,
> the old `/api/vidiq/stats` endpoint returns 503 when the key is
> missing or expired. Switch to `/api/youtube/channel-stats` (the
> response shape is identical).

### `🔭 Vidi-Research` button does nothing

Check that `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` are set
in `.env` and that your OpenClaw gateway is running and reachable.
See `docs/vidi-agent.md` for the full operational checklist.

### Kanban columns stack vertically

Make sure `<div id="kanbanBoard">` has `class="board"`. The class is
required for the CSS grid.

### New videos aren't auto-importing

Your YouTube OAuth refresh token has likely expired or been revoked.
Run `npm run oauth:check` to see the current state, then
`npm run oauth:setup` to re-authenticate. The `/health/oauth` endpoint
on the MCP server (default `http://localhost:8190/health/oauth`) is
suitable for an Uptime-Kuma HTTP monitor.

---

## Contributing

This is a personal project shared publicly under MIT. Issues and PRs
are welcome but expect a slow response — Dirk treats it as a learning
lab, not a production codebase. See [AGENTS.md](./AGENTS.md) for the
parts most relevant to AI agents.

---

*"Plan your content, Pinguin."* 🐧

By Nix 🐧 & Dirk, 2026. *"Number 5 is alive."*
