# AI Agent Integration Guide

This guide explains how AI assistants can interact with Contentix via
its REST API. Contentix is designed to be **agent-first**: every
endpoint, every field, every status value is documented here so that
an LLM can drive the app end-to-end without poking at the frontend.

---

## Quick reference

**App URL:** `http://localhost:3038` (or your reverse-proxied host)  
**API base:** `http://localhost:3038/api/`  
**vidIQ MCP:** `https://mcp.vidiq.com/mcp` (protocol v2024-11-05)  
**OpenClaw gateway:** `http://localhost:18789` (only if you use 🔭 Vidi-research)

---

## Authentication

Contentix is single-user and local-first. There is **no auth layer**:
the app trusts whatever can reach port 3038. If you expose it via
reverse proxy, put it behind a VPN or HTTP basic auth in nginx.

The vidIQ key is server-side only. Agents never see the key.

---

## Available endpoints

### Videos

| Action | Method | Endpoint |
|--------|--------|----------|
| List all videos | GET | `/api/videos` |
| Get single video | GET | `/api/videos/:id` |
| Create video | POST | `/api/videos` |
| Update video | PUT | `/api/videos/:id` |
| Delete video | DELETE | `/api/videos/:id` |

### Scripts

| Action | Method | Endpoint |
|--------|--------|----------|
| List all scripts | GET | `/api/scripts` |
| Get single script | GET | `/api/scripts/:id` |
| Create script | POST | `/api/scripts` |
| Update script | PUT | `/api/scripts/:id` |
| Delete script | DELETE | `/api/scripts/:id` |
| Import .md file | POST | `/api/scripts/import` |
| List folders | GET | `/api/scripts/folders` |

### History (soft archive)

| Action | Method | Endpoint |
|--------|--------|----------|
| List archived videos | GET | `/api/history` |
| Archive a video | POST | `/api/videos/:id/archive` |
| Restore from archive | POST | `/api/videos/:id/restore` |
| Restore a script | POST | `/api/scripts/:id/restore` |

### vidIQ integration

| Action | Method | Endpoint |
|--------|--------|----------|
| Get cached stats | GET | `/api/vidiq/stats` |
| Refresh from vidIQ | POST | `/api/vidiq/refresh` |
| Poll refresh status | GET | `/api/vidiq/refresh/status/:jobId` |
| Get video stats | POST | `/api/vidiq/video-stats/:videoId` |
| Get watchtime (28d) | GET | `/api/vidiq/watchtime` |

### Vidi research (v0.10+, optional)

The 🔭 button on every Kanban card spawns the **Vidi** subagent
(OpenClaw agent `youtubebot`) which collects vidIQ data and writes
the result back into the card. Vidi is a scout, not a coach — see
`docs/vidi-agent.md` for the architecture and role split.

| Action | Method | Endpoint |
|--------|--------|----------|
| Trigger research run | POST | `/api/research/:videoId` |
| Poll research job | GET | `/api/research/:jobId` |
| Cancel research job | DELETE | `/api/research/:jobId` |
| List jobs | GET | `/api/research?videoId=&status=` |

### Health

| Action | Method | Endpoint |
|--------|--------|----------|
| Health check + version | GET | `/api/health` |

---

## Video object

```json
{
  "id": "uuid",
  "title": "Video Title",
  "status": "planned|research|script|recording|done|published",
  "video_format": "longform|shorts|livestream",
  "thumbnail_url": "https://...",
  "planned_date": "2026-04-20T14:00:00Z",
  "published_date": "2026-04-20T14:00:00Z",
  "video_id": "dAOaX-5KHMw",
  "youtube_url": "https://youtube.com/watch?v=dAOaX-5KHMw",
  "tags": "linux,gaming",
  "notes": "Research notes...",
  "nix_comment": "AI-generated comment...",
  "nix_comment_source": "manual|vidiq|nix",
  "owner": "dirk",
  "position": 1,
  "created_at": "2026-04-17T12:00:00Z",
  "updated_at": "2026-04-17T14:00:00Z"
}
```

### Status field (pipeline)

The `status` field has **6 valid values**, representing the YouTube
production pipeline:

| Status | Meaning | Kanban column | Notes |
|--------|---------|---------------|-------|
| `planned` | Idea / not started | `ideas` (💡) | Default for new videos |
| `research` | Research phase | `research` (🔬) | Gathering material |
| `script` | Writing script | `skript` (✏️) | Linked to `/api/scripts` record |
| `recording` | Recording in progress | `recording` (🎬) | |
| `done` | Uploaded to YouTube (not yet public) | `uploaded` (✅) | May have `video_id` but not public |
| `published` | Live on YouTube | (no column) | Only in Calendar/Bibliothek |

**Validation:** backend does not currently reject unknown status
values. Frontend uses `STATUS_MAP` in `frontend/kanban.js` to translate
between board columns and DB status values.

**Migration history:**

- v0.1.0 (2026-04-17): `planned | published | draft` (3 values)
- v0.9.0 (2026-05-29): 5 values + the `script` and `recording` stages
- v0.9.3 (2026-06-03): `owner` column added; schema is now stable

### Owner field (v0.9.3+)

`owner` is a free-form string identifying the human or agent who
created the card. Default `'dirk'`. Future values may include `'nix'`
or `'vidi'` to denote agent-created cards. The frontend renders an
emoji avatar based on the value.

---

## Script object

```json
{
  "id": "uuid",
  "title": "Script Title",
  "slug": "script-title",
  "folder": "scripts|channel|resources",
  "status": "draft|in-review|final",
  "content": "# Markdown content...",
  "video_id": "dAOaX-5KHMw",
  "video_format": "longform|shorts|livestream",
  "tags": ["tag1", "tag2"],
  "position": 1,
  "created_at": "2026-04-17T12:00:00Z",
  "updated_at": "2026-04-17T14:00:00Z"
}
```

**Required field:** `slug` (URL-safe lowercase with hyphens). The
backend does not auto-generate it; if you POST a script without a
slug, you'll get a 500. Use a slugifier:

```js
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
```

**`folder`** is one of the default folders `scripts`, `Entwürfe`,
`channel`, `resources`, `Archiv`, or any custom string. The frontend
groups scripts by folder. The `Archiv` folder is collapsed by default
and drag & drop into/from it auto-flips the `status` field between
`archived` and `draft`.

**`status`** is one of: `draft` (default), `in-review`, `final`,
`archived`. The archive-state can be set manually or by dragging a
script into the `Archiv` folder. Use `POST /api/scripts/:id/restore`
to bring an archived script back.

---

## Usage examples

### Create a video

```bash
curl -X POST http://localhost:3038/api/videos \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Linux Gaming Guide",
    "status": "planned",
    "video_format": "longform",
    "planned_date": "2026-04-20T14:00:00Z"
  }'
```

### Move a video to the script column

```bash
curl -X PUT http://localhost:3038/api/videos/<id> \
  -H 'Content-Type: application/json' \
  -d '{ "status": "script" }'
```

### Link a script to a video

```bash
curl -X PUT http://localhost:3038/api/scripts/<script-id> \
  -H 'Content-Type: application/json' \
  -d '{ "video_id": "dAOaX-5KHMw" }'
```

### Trigger a Vidi-research run (v0.10+)

```bash
curl -X POST http://localhost:3038/api/research/<video-id> \
  -H 'Content-Type: application/json' \
  -d '{ "agent": "youtubebot", "brief": "Custom research brief here" }'
# → { "jobId": "...", "status": "pending" }
```

Poll for the result:

```bash
curl http://localhost:3038/api/research/<jobId>
# → { "status": "done", "result": {...}, "elapsedSec": 217, ... }
```

### Refresh vidIQ data (costs API credits)

```bash
curl -X POST http://localhost:3038/api/vidiq/refresh
# → { "jobId": "..." }
curl http://localhost:3038/api/vidiq/refresh/status/<jobId>
```

---

## Environment variables (server-side)

- `VIDIQ_API_KEY` — required for vidIQ MCP access
- `PORT` — default 3038
- `DATA_DIR` — where `contentix.db` lives (default: next to `index.js`)
- `LOG_LEVEL` — `info` | `debug` | `silent`
- `OPENCLAW_GATEWAY_URL` — optional, for the v0.10 research feature
- `OPENCLAW_GATEWAY_TOKEN` — optional, paired with the URL

---

## MCP integration (advanced)

Contentix itself uses vidIQ's MCP protocol for YouTube channel data:

```js
// Initialize MCP
const init = await fetch('https://mcp.vidiq.com/mcp', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ***',
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contentix', version: '1.0' } },
  }),
});

// Call a tool
const stats = await fetch('https://mcp.vidiq.com/mcp', {
  method: 'POST',
  headers: { /* same */ },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'vidiq_channel_stats', arguments: { channelId: 'YOUR_CHANNEL_ID' } },
  }),
});
```

The full client lives in `index.js` (search for `makeVidiqCmd` and
`parseVidiqResponse`).

---

## Agent notes

- All timestamps are ISO 8601 format.
- Tags are stored as **comma-separated strings** for videos, and
  **JSON arrays** for scripts. Convert when crossing the boundary.
- Video IDs are YouTube video IDs (11 characters).
- vidIQ refresh is rate-limited — check `/api/vidiq/stats` cached
  data before triggering a fresh fetch.
- The 🔭 research endpoint (v0.10+) is async and returns a `jobId`
  immediately. Always poll `GET /api/research/:jobId` rather than
  blocking.
- Research jobs are 1-per-video at a time: a second `POST` while
  one is running returns HTTP 409.

---

*By Nix 🐧 & Dirk, 2026. "Be resourceful, not performative."*
