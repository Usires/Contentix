# Contentix YouTube MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server
that exposes the **YouTube Data API v3** + **YouTube Analytics API** as
MCP tools. Built for Contentix, but works with any MCP client.

Two auth modes:

- **API Key** — public data on any channel/video (channel stats, video stats, search)
- **OAuth 2.0** — private data on the authenticated user's own channel
  (analytics, watchtime, real-time stats, subscriber changes)

## Tools

| Tool | Auth | Purpose |
|------|------|---------|
| `youtube_channel_stats` | API-Key | Get snippet + statistics for any public channel by ID or `@handle` |
| `youtube_video_stats` | API-Key | Get snippet + statistics + contentDetails for any public video |
| `youtube_my_channel` | OAuth | Own channel identity + stats |
| `youtube_my_recent_videos` | OAuth | Own latest uploads with per-video stats |
| `youtube_search_videos` | API-Key | Search YouTube, optionally filtered to one channel |
| `youtube_my_analytics` | OAuth | YouTube Analytics for own channel (views, watchtime, etc.) |

## Setup (one-time, ~5 minutes)

### 1. Google Cloud Console

a. Go to https://console.cloud.google.com/ — pick or create a project.

b. Enable **YouTube Data API v3**:
   - APIs & Services → Library → search "YouTube Data API v3" → Enable
   - Also enable **YouTube Analytics API** if you want `youtube_my_analytics`

c. Create an **API Key** (for public data):
   - APIs & Services → Credentials → "+ Create Credentials" → "API key"
   - Copy the key. Restrict it to "YouTube Data API v3" for safety.

d. Create an **OAuth 2.0 Client ID** (for own-channel data):
   - APIs & Services → Credentials → "+ Create Credentials" → "OAuth client ID"
   - Application type: **Desktop app**
   - Name: anything (e.g. "Contentix MCP Server")
   - Authorized redirect URI: `http://localhost:8190/auth/callback`
   - Copy Client ID and Client Secret.

### 2. Environment

```bash
cp .env.example .env
# Edit .env with your API key, Client ID, Client Secret
```

### 3. Install + run

```bash
npm install
node server.js
# Or via systemd:
systemctl --user daemon-reload
systemctl --user enable --now contentix-youtube-mcp
journalctl --user -u contentix-youtube-mcp -f
```

### 4. One-time OAuth login

Open http://localhost:8190/auth in a browser, sign in with the Google
account that owns your YouTube channel, grant permissions. You'll be
redirected back to `/auth/callback` which saves the refresh token to
`data/oauth-token.json`. Done — auto-refresh from now on.

Verify: `curl http://localhost:8190/auth/status`

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness check |
| `GET /auth` | Start OAuth flow (browser) |
| `GET /auth/callback` | OAuth callback (Google → us) |
| `GET /auth/status` | Is a refresh token saved? |
| `GET /sse` | MCP transport (SSE) |
| `POST /messages` | MCP messages |

## Development

```bash
npm run dev   # node --watch server.js
npm test      # node --test tests/
```

## License

MIT — By Nix 🐧 & Dirk, 2026.
