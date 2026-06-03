# AI Agent Integration Guide

This guide explains how AI assistants can interact with Contentix via its REST API.

## Quick Reference

**App URL:** `http://localhost:3038` (or your deployed URL)  
**API Base:** `http://localhost:3038/api/`  
**vidIQ MCP:** `https://mcp.vidiq.com/mcp` (protocol v2024-11-05)

## Available Endpoints

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
| Create script | POST | `/api/scripts` |
| Update script | PUT | `/api/scripts/:id` |
| Delete script | DELETE | `/api/scripts/:id` |
| Import .md file | POST | `/api/scripts/import` |
| List folders | GET | `/api/scripts/folders` |

### vidIQ Integration

| Action | Method | Endpoint |
|--------|--------|----------|
| Get cached stats | GET | `/api/vidiq/stats` |
| Refresh from vidIQ | POST | `/api/vidiq/refresh` |
| Get video stats | POST | `/api/vidiq/video-stats/:videoId` |

### Health

| Action | Method | Endpoint |
|--------|--------|----------|
| Health check | GET | `/api/health` |

## Video Object

```json
{
  "id": "uuid",
  "title": "Video Title",
  "status": "planned|published|in-editing",
  "video_format": "longform|shorts|livestream",
  "thumbnail_url": "https://...",
  "planned_date": "2026-04-20T14:00:00Z",
  "published_date": "2026-04-20T14:00:00Z",
  "video_id": "dAOaX-5KHMw",
  "youtube_url": "https://youtube.com/watch?v=dAOaX-5KHMw",
  "tags": "linux,gaming",
  "notes": "Research notes...",
  "nix_comment": "AI-generated comment...",
  "nix_comment_source": "manual|auto",
  "position": 1,
  "created_at": "2026-04-17T12:00:00Z",
  "updated_at": "2026-04-17T14:00:00Z"
}
```

## Script Object

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

## Usage Examples

### Create a video
```javascript
fetch('/api/videos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Linux Gaming Guide',
    status: 'planned',
    video_format: 'longform',
    planned_date: '2026-04-20T14:00:00Z'
  })
});
```

### Link a script to a video
```javascript
fetch('/api/scripts/40996f05-a4c6-4cf9-a119-fd295ec1dc57', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ video_id: 'dAOaX-5KHMw' })
});
```

### Refresh vidIQ data (costs API credits)
```javascript
fetch('/api/vidiq/refresh', { method: 'POST' });
```

## Environment Variables

- `VIDIQ_API_KEY` — Required for vidIQ MCP access
- Port: default 3038

## MCP Integration (Advanced)

Contentix uses vidIQ's MCP protocol for YouTube channel data:

```javascript
// Initialize MCP
curl -X POST "https://mcp.vidiq.com/mcp" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'

// Get channel stats
curl -X POST "https://mcp.vidiq.com/mcp" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vidiq_channel_stats","arguments":{"channelId":"YOUR_CHANNEL_ID"}}}'
```

## Agent Notes

- All timestamps are ISO 8601 format
- Tags are stored as comma-separated strings (videos) or JSON arrays (scripts)
- Video IDs are YouTube video IDs (11 characters)
- vidIQ refresh is rate-limited — check `/api/vidiq/stats` cached data before triggering a fresh fetch