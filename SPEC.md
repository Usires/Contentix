# Contentix — Specification

*YouTube Content Planner — By Nix & Dirk — last revised 2026-06-12*

> **Note:** this is the **current** specification. The original Phase-1
> spec (5.1–5.6 below) is preserved as historical context. The actual
> system has grown well beyond it — see [MAKINGOF.md](./MAKINGOF.md)
> for the story of how we got here and [README.md](./README.md) for
> the live architecture.

---

## 1. Overview

**Name:** Contentix (Content + Nix)  
**Purpose:** Self-hosted Kanban + Calendar + Script editor for solo
YouTube creators, with vidIQ insights and (optionally) Nix/Vidi
AI-research integration.  
**Version at time of writing:** 0.10.2

---

## 2. Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express + sql.js (SQLite in-process) |
| Frontend | Vanilla JS + CSS (no framework, no build step) |
| Database | SQLite (`contentix.db`, single file) |
| Default port | `3038` (configurable via `PORT`) |
| Reverse proxy | any (we use nginx in production) |
| vidIQ | MCP HTTP(SSE) — on-request, cached aggressively |
| OpenClaw | optional — for the v0.10+ Nix-research feature |
| Container | `node:20-alpine`, multi-stage not needed |

---

## 3. Database schema (v0.10.2)

### `videos`

```sql
CREATE TABLE videos (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'planned',
  planned_date    TEXT,
  published_date  TEXT,
  video_id    TEXT,                    -- YouTube video ID (11 chars)
  youtube_url TEXT,
  tags        TEXT,                    -- comma-separated string
  notes       TEXT,
  nix_comment TEXT,                    -- last AI/agent comment
  nix_comment_source TEXT DEFAULT 'manual',  -- 'manual' | 'vidiq' | 'nix'
  owner       TEXT DEFAULT 'dirk',     -- 'dirk' | 'nix' | 'vidi' (multi-agent ready)
  position    INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

### `scripts`

```sql
CREATE TABLE scripts (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL,
  folder       TEXT DEFAULT 'scripts',
  status       TEXT DEFAULT 'draft',   -- 'draft' | 'in-review' | 'final'
  content      TEXT DEFAULT '',
  video_id     TEXT,                    -- optional FK to videos.video_id
  video_format TEXT DEFAULT 'longform',
  tags         TEXT DEFAULT '[]',
  position     INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### `vidiq_cache` / `vidiq_video_cache`

Per-channel / per-video JSON caches. Saves credits.

### `vidiq_refresh_jobs`

Async bookkeeping for `POST /api/vidiq/refresh`.

### `research_jobs` (v0.10+)

Async bookkeeping for `POST /api/research/:videoId` (Vidi runs).

---

## 4. Status pipeline

`videos.status` has **6 valid values**. The first 5 map to Kanban
columns; the 6th is the post-board final state.

| Status | Meaning | Kanban column | Visible elsewhere |
|--------|---------|---------------|-------------------|
| `planned` | Idea, not started | `ideas` (💡) | — |
| `research` | Research in progress | `research` (🔬) | — |
| `script` | Script being written | `skript` (✏️) | — |
| `recording` | Recording in progress | `recording` (🎬) | — |
| `done` | Uploaded to YouTube (not public yet) | `uploaded` (✅) | — |
| `published` | Live on YouTube | (no column) | Calendar, Bibliothek |

**Migration history:**

- v0.1.0 (2026-04-17): 3 values: `planned | published | draft`
- v0.9.0 (2026-05-29): 5 values, Kanban gets a 5-stage pipeline
- v0.9.3 (2026-06-03): `owner` column added; the schema is now
  considered final

**Validation:** the backend does not currently reject unknown status
values. Frontend uses `STATUS_MAP` in `frontend/kanban.js` to translate
between board columns and DB status values.

---

## 5. Historical: original Phase-1 spec (2026-04-16)

The MVP that Contentix started as. Kept here for context — the
shipped product has grown well past it.

### 5.1 Goals (Phase 1)

- Calendar view (Month + Week) for content planning
- Video cards with status, dates, tags, notes
- vidIQ channel stats on request
- Nix AI-comment placeholder

### 5.2 Tech (Phase 1)

- Node.js + Express + sql.js
- Vanilla JS + CSS frontend
- Port 3038

### 5.3 Database (Phase 1)

`videos` table only (4 columns: `id`, `title`, `status`,
`published_date`). No `tags`, no `notes`, no `nix_comment`, no scripts
table, no vidIQ cache.

### 5.4 Endpoints (Phase 1)

5 routes: `GET/POST /api/videos`, `GET /api/vidiq/stats`,
`POST /api/vidiq/refresh`, `GET /api/health`. No scripts, no research,
no history.

### 5.5 Design (Phase 1)

- Dark theme only (no seasonal variants)
- JetBrains Mono everywhere
- Sidebar with "Nix Dashboard" + stat badges
- Konami code Easter egg

### 5.6 Easter eggs (Phase 1)

- ASCII Nix penguin in footer (`🐧`)
- Konami code reveals a secret Nix quote
- Subtle CRT scanline overlay (2% opacity)

### 5.7 What changed between Phase 1 and now

See [MAKINGOF.md](./MAKINGOF.md) for the full story. TL;DR:

- The Phase-1 calendar was replaced by a Kanban-first design (Dirk's
  editorial workflow lives in the columns, not in dates).
- 5 seasonal themes replaced the single dark theme.
- The script editor was added (markdown + link to video + print view).
- The history view was added (soft archive instead of hard DELETE).
- The Nix-research bridge (v0.10) was added — Contentix can now
  trigger a Vidi AI-research run and stream the result back.

---

## 6. API endpoint reference

The full table is in [AGENTS.md](./AGENTS.md). Highlights:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Liveness + version |
| `/api/videos` | GET/POST | List/create videos |
| `/api/videos/:id` | GET/PUT/DELETE | Read/update/delete one video |
| `/api/scripts` | GET/POST | List/create scripts |
| `/api/scripts/folders` | GET | List script folders (static, before `:id` route) |
| `/api/scripts/:id` | GET/PUT/DELETE | Read/update/delete one script |
| `/api/scripts/import` | POST | Import a `.md` file as a script |
| `/api/history` | GET | List archived videos |
| `/api/vidiq/refresh` | POST | Async refresh (returns `jobId` immediately) |
| `/api/vidiq/refresh/status/:jobId` | GET | Poll a vidIQ refresh |
| `/api/vidiq/stats` | GET | Cached channel stats |
| `/api/research/:videoId` | POST | Trigger a Nix/Vidi research run (v0.10+) |
| `/api/research/:jobId` | GET | Poll a research job |
| `/api/research/:jobId` | DELETE | Cancel a research job |
| `/api/research?videoId=&status=` | GET | List research jobs |

---

## 7. Design tokens

The frontend uses CSS custom properties for theme-awareness. The
canonical list lives in `frontend/styles.css`. Key tokens:

- `--nix-violet`, `--nix-violet-light`, `--nix-violet-dark`
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- `--text-primary`, `--text-secondary`
- `--text-on-dark`, `--text-on-dark-secondary`
- `--warning`, `--success`, `--cal-header-fg`, `--bg-cal-header`

Each theme (Nix Violet default, Frühling, Sommer, Herbst, Winter)
redefines these tokens.

---

## 8. Non-goals (still)

Things Contentix explicitly does **not** do:

- ❌ Multi-user collaboration (single-user, local-first)
- ❌ Direct YouTube upload (videos are linked, not pushed)
- ❌ Analytics dashboards (vidIQ gives the raw numbers, we don't
  re-charthem)
- ❌ Cloud sync (the SQLite file is your data; back it up however you
  want)
- ❌ Mobile app (the responsive web UI works on tablets, but not on
  phones)

---

*By Nix 🐧 & Dirk, 2026. We build our own story.*
