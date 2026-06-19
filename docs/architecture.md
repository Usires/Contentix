# Contentix Architecture

> **Status:** v0.10.2 (May 2026)
> **Stack:** Node.js + Express + better-sqlite3 (NO Docker)
> **URL:** `http://contentix.asbach-games.fritz.box` (port 3038, reverse-proxied)

## High-Level

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Sidebar (Nav)  │    │ View Panels     │    │  Modals         │
│  - Bibliothek   │    │  - Bibliothek   │    │  - Vidi-Research│
│  - Workflow     │    │  - Kalender     │    │  - Print        │
│  - Kalender     │◄──►│  - Kanban       │◄──►│  - Toasts       │
│  - Skripte      │    │  - Skripte      │    │                 │
│  - History      │    │  - History      │    │                 │
│  - Settings     │    │                 │    │                 │
└─────────────────┘    └────────┬────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  app.js         │
                       │  (state, init)  │
                       └────────┬────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│  REST API  (index.js, Express)                                │
│  /api/scripts   /api/videos   /api/research                   │
│  /api/vidiq/*   /api/calendar /api/kanban                     │
│  /api/links     /api/history                                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  SQLite             │
              │  contentix.db       │
              │  (better-sqlite3)   │
              │  WAL mode           │
              └─────────────────────┘
```

## Folder Structure

```
/home/dirk/contentix/
├── index.js              # Express server + REST API
├── contentix.db          # SQLite database
├── frontend/             # Static files served at /
│   ├── index.html        # Main shell
│   ├── app.js            # Global state, init, navigation
│   ├── bibliothek.js     # Bibliothek view (hero + grids)
│   ├── bibliothek.html   # (HTML fragment for that view)
│   ├── kanban.js         # Kanban view
│   ├── calendar.js       # Calendar view
│   ├── history.js        # History view
│   ├── scripts.js        # Skripte view (JSTree editor)
│   ├── store.js          # Lightweight state management
│   ├── effects.js        # Toast/notification helpers
│   ├── utils.js          # Common helpers (escapeHtml, etc.)
│   └── styles.css        # Global styles (Nix-Violett theme)
├── docs/                 # Architecture + spec docs
│   ├── architecture.md   # This file
│   ├── bibliothek-redesign.md
│   └── vidi-agent.md
└── contentix.log         # Application log
```

## Database Schema

```sql
-- Videos (YouTube metadata, refreshed via vidIQ MCP)
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT, description TEXT, video_id TEXT UNIQUE,
  thumbnail_url TEXT, published_at TEXT, duration_seconds INTEGER,
  tags TEXT,  -- JSON array
  view_count INTEGER, like_count INTEGER, comment_count INTEGER,
  category_id TEXT, default_audio_lang TEXT,
  performance_score REAL,  -- vidIQ score
  last_refreshed_at TEXT,
  created_at TEXT, updated_at TEXT
);

-- Scripts (Markdown content for each video concept)
CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  title TEXT, slug TEXT UNIQUE,
  folder TEXT DEFAULT 'scripts',  -- 'scripts'|'Entwürfe'|'channel'|'resources'|'Archiv'
  status TEXT DEFAULT 'draft',    -- 'draft'|'in-review'|'final'|'archived'
  content TEXT,                  -- Markdown
  video_id TEXT,                 -- FK to videos
  video_format TEXT,             -- 'longform'|'short'|'livestream'
  tags TEXT,                     -- JSON array
  position INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

-- Research jobs (Vidi AI agent runs)
CREATE TABLE research_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT,                  -- FK to videos
  agent_id TEXT,                  -- 'vidi' for now
  status TEXT,                    -- 'pending'|'running'|'completed'|'failed'
  progress_message TEXT,
  result TEXT,                    -- JSON blob
  error TEXT,
  started_at TEXT, finished_at TEXT
);

-- VidIQ cached channel data
CREATE TABLE vidiq_cache (
  key TEXT PRIMARY KEY,
  value TEXT,                     -- JSON
  expires_at TEXT,
  updated_at TEXT
);

-- Watchtime sidecar (avoid clobbering)
CREATE TABLE vidiq_watchtime (
  channel_id TEXT PRIMARY KEY,
  minutes INTEGER,
  avg_view_pct REAL,
  refreshed_at TEXT
);
```

## REST API Reference

### Scripts
- `GET  /api/scripts` — list all (returns parsed tags as array)
- `GET  /api/scripts/folders` — distinct folder names
- `GET  /api/scripts/:id` — single script
- `POST /api/scripts` — create (uuid auto-generated)
- `PUT  /api/scripts/:id` — partial update
- `DELETE /api/scripts/:id` — hard delete
- `PATCH /api/scripts/:id/link` — link/unlink video
- `POST  /api/scripts/:id/restore` — restore from archive
- `POST  /api/scripts/import` — import from .md file

### Videos
- `GET  /api/videos` — list all
- `GET  /api/videos/:id` — single video
- `POST /api/videos` — create
- `PUT  /api/videos/:id` — update
- `DELETE /api/videos/:id` — delete
- `POST /api/videos/:id/archive` — soft-archive
- `POST /api/videos/:id/restore` — restore

### VidIQ (cached)
- `POST /api/vidiq/refresh` — trigger full refresh (background job)
- `GET  /api/vidiq/status/:jobId` — poll job status
- `GET  /api/vidiq/channels` — list tracked channels
- `GET  /api/vidiq/watchtime` — last 28d watchtime

### Research (Vidi agent)
- `POST /api/research/:videoId` — trigger 1-Klick Vidi research
- `GET  /api/research/:jobId` — poll progress

### Misc
- `GET  /api/calendar` — calendar events
- `GET  /api/kanban` — kanban cards
- `GET  /api/history` — change history
- `GET  /api/health` — health check (no auth)

## Authentication

Currently **NO authentication** — the service runs on a private LAN
behind a reverse proxy. Sessions are tracked by IP for rate-limiting.
Public access (via Fritz!Box) is filtered by UFW.

## Sidecar Systems

### VidIQ MCP Integration
- MCP server runs separately, called via `mcp__vidiq__*` tools
- Background jobs poll job status, cache results in `vidiq_cache` table
- 5-22 vidIQ credits per call, budget-tracked manually

### Vidi Research Agent
- Sub-agent spawned via `openclaw agent --agent vidi --message "..." --timeout 300`
- Writes progress to `research_jobs` table, frontend polls via `GET /api/research/:jobId`
- Spawns OpenClaw subprocess for AI inference (currently M3 / minimax)

### OpenClaw Embedding Worker
- `node memory-core-local-embedding-worker.js` — uses llama-cpp + nomic-embed
- Provides local embeddings for the workspace's memory RAG

## Deployment

Service is managed by **systemd** at `/etc/systemd/system/contentix.service`
(enabled, auto-restart). Started via:

```bash
sudo systemctl restart contentix
```

Logs: `contentix.log` (rotated weekly).

## Conventions

- **Markdown body**: Scripts use standard Markdown
- **Date format**: `YYYY-MM-DD` ISO-8601 in DB; displayed in `de-DE` locale
- **Tag system**: Tags are stored as JSON in `tags` column, parsed on read
- **Folder strings**: Free-form strings, validated client-side only
  - Valid folders: `scripts`, `Entwürfe`, `channel`, `resources`, `Archiv`
- **Status state machine**:
  ```
  draft → in-review → final → archived
                              ↑ ↓
                              └─┘ (restore)
  ```

## Open Architecture Questions

1. **`script_folders` table**: Should we replace folder-strings with a proper
   canonical table? (parent/position). Cost: 8 scripts migration, API breakage.
2. **Webhook for Vidi progress**: Currently `tail -F`-on-stderr hack. Could
   use proper webhook callback for cleaner logs.
3. **Multi-user auth**: Currently single-user, no auth. When more than
   Dirk uses Contentix, we need a login system.
