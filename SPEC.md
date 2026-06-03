# Contentix — SPEC.md

*YouTube Content Planner — By Nix & Dirk — 2026-04-16*

---

## 1. Overview

**Name:** Contentix (Content + Nix)  
**Purpose:** Calendar-based YouTube content planner with vidIQ insights  
**Phase 1:** MVP — Calendar View + Video Cards + Manual Entry + vidIQ Dashboard (on-request)

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express + SQLite |
| Frontend | Vanilla JS + CSS |
| Database | SQLite (`contentix.db`) |
| Port | 3038 (backend) → reverse proxy |
| vidIQ | MCP HTTP(SSE) — on-request only |

---

## 3. Database Schema

### videos
```sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'planned',  -- 'planned' | 'research' | 'script' | 'recording' | 'done' | 'published'
                                -- planned   = idea, not started
                                -- research  = gathering material
                                -- script    = writing script
                                -- recording = recording in progress
                                -- done      = uploaded to YouTube
                                -- published = live on YouTube (calendar/bibliothek only)
  planned_date TEXT,
  published_date TEXT,
  video_id TEXT,                   -- YouTube video ID
  youtube_url TEXT,
  tags TEXT,                        -- JSON array
  notes TEXT,
  nix_comment TEXT,
  nix_comment_source TEXT,          -- 'manual' | 'vidiq' | 'nix'
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### vidiq_cache
```sql
CREATE TABLE vidiq_cache (
  channel_id TEXT PRIMARY KEY,
  data TEXT,                        -- JSON
  fetched_at TEXT
);
```

---

## 4. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/videos` | List all videos |
| POST | `/api/videos` | Create video |
| GET | `/api/videos/:id` | Get video |
| PATCH | `/api/videos/:id` | Update video |
| DELETE | `/api/videos/:id` | Delete video |
| GET | `/api/videos/calendar/:year/:month` | Videos for month |
| GET | `/api/vidiq/stats` | Channel stats (cached) |
| POST | `/api/vidiq/refresh` | Refresh vidIQ data |
| POST | `/api/vidiq/video-stats/:videoId` | Get video stats |

---

## 5. Design

### Colors
- Background: `#0d1117`
- Card bg: `#161b22`
- Border: `#30363d`
- Text: `#e6edf3`
- Muted: `#8b949e`
- Accent planned: `#f0b429` (yellow)
- Accent published: `#238636` (green)
- Accent draft: `#1f6feb` (blue)
- Nix accent: `#79c0ff` (light blue)

### Typography
- Primary: `JetBrains Mono` (monospace, nerd aesthetic)
- Fallback: `Fira Code`, `monospace`

### Layout
- Full-viewport calendar grid
- Header: Month/Year navigation + Week/Month toggle
- Calendar: 7-column grid, each day a cell
- Sidebar (desktop): Nix Dashboard + Stats
- Mobile: Stack vertically

### Easter Eggs
- Small ASCII Nix penguin in footer (`🐧`)
- Konami code reveals secret Nix quote
- Subtle CRT scanline overlay (very light, 2% opacity)

---

## 6. Features — Phase 1

### Calendar View
- [x] Month view (default): 6-week grid, days with videos show dots
- [x] Week view: 7 columns, larger cards
- [x] Navigate months/weeks with ◀ ▶
- [x] Today indicator (border highlight)
- [x] Click day to see/add videos

### Video Cards
- [x] Show video title, status badge
- [x] Click to expand/edit
- [x] Drag to reschedule (future)
- [x] Color-coded by status

### Nix Dashboard (Sidebar)
- [x] Current month at a glance
- [x] Next planned video
- [x] vidIQ stats button (on-request)
- [x] Nix comment placeholder

### vidIQ Integration (on-request)
- [x] Button: "vidIQ refresh" — fetches fresh data
- [x] Shows channel stats (subs, views, growth)
- [x] Shows credits remaining
- [x] Manual refresh only (no auto-poll)

---

## 7. Status Codes

| Status | Color | Meaning |
|--------|-------|---------|
| `planned` | 🟡 yellow | Scheduled, not published |
| `published` | 🟢 green | Live on YouTube |
| `draft` | 🔵 blue | Idea, not scheduled |

---

## 8. NixBoard Comparison

| | NixBoard | Contentix |
|--|---------|-----------|
| View | Kanban | Calendar |
| Port | 3036 | 3038 |
| Focus | Tasks | YouTube Content |
| vidIQ | No | Yes (on-request) |

---

*Let's plan some content. — Nix 🐧*
