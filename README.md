# Contentix — YouTube Content Planner

*A self-hosted Kanban + Calendar + Script editor for solo YouTube creators, with vidIQ insights baked in.*

By Nix 🐧 & Dirk, 2026. Licensed under [MIT](./LICENSE).

---

## What is it?

Contentix is a single-binary web app for planning YouTube videos end to end:

- 📋 **Kanban board** with a 5-stage status pipeline (ideas → research →
  script → recording → uploaded) plus a separate `published` status for
  videos that are actually live on YouTube.
- 📅 **Calendar view** (Month + Week) with cards positioned by planned
  and published dates.
- ✏️ **Script editor** with markdown preview, link-to-video, archive
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
  that gathers vidIQ data, not a coach. See `docs/vidi-agent.md` for
  the architecture.
- 🎨 **Seasonal themes** (Nix Violet default + four others) with
  per-theme colour tokens.

**Stack:** Node.js + Express + sql.js (SQLite in-process) — frontend
and backend in a single app. Port `3038`.

**vidIQ:** MCP-based integration for channel and video stats. Each
fresh call costs vidIQ credits, so the app caches aggressively in
`vidiq_cache` and `vidiq_video_cache`.

---

## Quick Start (Docker)

```bash
git clone https://github.com/Usires/contentix.git
cd contentix
cp .env.example .env
# edit .env and add your VIDIQ_API_KEY
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
# edit .env and add your VIDIQ_API_KEY
npm install
./start.sh       # → http://localhost:3038
```

`start.sh` is a thin wrapper around `restart.sh` — both are idempotent
and use a PID file under `./contentix.pid`.

---

## Environment variables

See [`.env.example`](./.env.example) for the full list. The only
required one is `VIDIQ_API_KEY`. The OpenClaw variables are optional
and only needed if you want the 🔭 research feature.

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `VIDIQ_API_KEY` | yes | — | Get from [app.vidiq.com](https://app.vidiq.com) → Settings → API |
| `PORT` | no | `3038` | HTTP port |
| `DATA_DIR` | no | (next to `index.js`) | Where `contentix.db` lives. Docker sets this to `/app/data`. |
| `LOG_LEVEL` | no | `info` | `info` \| `debug` \| `silent` |
| `OPENCLAW_GATEWAY_URL` | no | — | e.g. `http://localhost:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | no | — | From `~/.openclaw/openclaw.json` |

---

## Architecture

```
contentix/
├── index.js              ← Backend: Express, REST API, vidIQ MCP client,
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
| `POST` | `/api/vidiq/refresh` | Trigger a vidIQ refresh (async, costs credits) |
| `GET` | `/api/vidiq/stats` | Cached channel stats |
| `GET` | `/api/vidiq/watchtime` | Cached watchtime (28-day window, 6h cache) |
| `POST` | `/api/research/:videoId` | Trigger a Nix research run (v0.10+) |
| `GET` | `/api/research/:jobId` | Poll a research job |
| `DELETE` | `/api/research/:jobId` | Cancel a research job |

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
- `vidiq_cache`, `vidiq_video_cache` — vidIQ responses, keyed by
  channel/video id. Saves credits.
- `vidiq_refresh_jobs` — async vidIQ-refresh bookkeeping.
- `research_jobs` — async Nix/Vidi research bookkeeping (v0.10+).

---

## vidIQ integration

The backend calls vidIQ's MCP (Model Context Protocol) via HTTP(SSE).
The MCP client lives in `index.js` (search for `makeVidiqCmd` and
`parseVidiqResponse`). Responses are cached aggressively — a fresh
video-stats call only happens when the cache is missing or stale.

**Credit-saving rules:**

- Channel stats: cached for 6 hours by default.
- Video stats: cached forever per `video_id`, only re-fetched if
  `title` or `thumbnail_url` are missing in the local row.
- The `POST /api/vidiq/refresh` endpoint is the only way to force a
  full refresh.

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

**Vidi is a scout, not a coach.** It gathers vidIQ data and quotes
sources. Strategic recommendations come from Nix (the main agent).
See `docs/vidi-agent.md` for the full architecture, role split,
cost model, and operational checklist.

For this to work, set `OPENCLAW_GATEWAY_URL` and
`OPENCLAW_GATEWAY_TOKEN` in your `.env`. If you don't, the 🔭 button
gracefully responds with a clear error message.

---

## Troubleshooting

### "EADDRINUSE" on startup

Another process is holding port `3038`. Run `./restart.sh` (it kills
the port-holder automatically) or `lsof -i :3038` / `ss -tlnp
sport = :3038` to find it manually.

### vidIQ stats show 0

Either your `VIDIQ_API_KEY` is wrong/expired, or you haven't triggered
a refresh yet. Hit the "vidIQ refresh" button in the sidebar.

### `🔭 Vidi-Research` button does nothing

Check that `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` are set
in `.env` and that your OpenClaw gateway is running and reachable.
See `docs/vidi-agent.md` for the full operational checklist.

### Kanban columns stack vertically

Make sure `<div id="kanbanBoard">` has `class="board"`. The class is
required for the CSS grid.

---

## Contributing

This is a personal project shared publicly under MIT. Issues and PRs
are welcome but expect a slow response — Dirk treats it as a learning
lab, not a production codebase. See [AGENTS.md](./AGENTS.md) for the
parts most relevant to AI agents.

---

*"Plan your content, Pinguin."* 🐧

By Nix 🐧 & Dirk, 2026. *"Number 5 is alive."*
