/**
 * youtube-api.js — Contentix client for the YouTube MCP server
 *
 * Analogous to the legacy vidiq-mcp.js but talks to our local MCP server
 * at http://127.0.0.1:8190 instead of vidIQ's paid MCP. Pure HTTP wrapper.
 *
 * Two auth modes (handled by the MCP server, not here):
 *   - API-Key: any public channel/video via YOUTUBE_API_KEY
 *   - OAuth: own channel + analytics (token saved server-side)
 *
 * The MCP server exposes JSON-RPC over SSE; for the simple lookup-style
 * calls we need from Contentix we hit /health and the tool execution
 * endpoints via HTTP. For now we go through a simpler wrapper: the MCP
 * server's tools are also exposed via the /tool/:name HTTP shortcut
 * (see server.js). This module prefers that for low-latency lookups.
 */

const http = require('http');

const MCP_HOST = process.env.YOUTUBE_MCP_HOST || '127.0.0.1';
const MCP_PORT = parseInt(process.env.YOUTUBE_MCP_PORT || '8190', 10);
const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}`;
const REQUEST_TIMEOUT_MS = parseInt(process.env.YOUTUBE_MCP_TIMEOUT_MS || '15000', 10);

const CHANNEL_ID = 'UC-YmLEIgdESaoVN3ZKNT_QA';

/**
 * Low-level HTTP call to a MCP tool via the /tool/:name endpoint.
 * Returns parsed JSON or throws.
 */
function callTool(name, args = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ arguments: args });
    const options = {
      host: MCP_HOST,
      port: MCP_PORT,
      path: `/tool/${encodeURIComponent(name)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: REQUEST_TIMEOUT_MS,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`MCP HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          // MCP responses come as { content: [{type:'text', text:'...'}], isError: bool }
          if (parsed.isError) {
            reject(new Error(parsed.content?.[0]?.text || 'MCP tool returned isError'));
            return;
          }
          const text = parsed.content?.[0]?.text;
          if (!text) {
            resolve(parsed);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        } catch (e) {
          reject(new Error(`MCP response parse failed: ${e.message} (body: ${body.slice(0, 200)})`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`MCP request failed: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy(new Error(`MCP timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.write(payload);
    req.end();
  });
}

// Convenience wrappers matching the MCP tool names.
// Each function returns the parsed tool result or throws.

function health() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: MCP_HOST, port: MCP_PORT, path: '/health', method: 'GET', timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ httpStatus: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('health timeout')));
    req.end();
  });
}

async function getChannelStats(channelId = CHANNEL_ID) {
  return callTool('youtube_channel_stats', { channelId });
}

async function getVideoStats(videoId) {
  return callTool('youtube_video_stats', { videoId });
}

async function getMyChannel() {
  return callTool('youtube_my_channel');
}

async function getMyRecentVideos(maxResults = 10) {
  return callTool('youtube_my_recent_videos', { maxResults });
}

async function getMyAnalytics({ metrics, days } = {}) {
  return callTool('youtube_my_analytics', {
    metrics: metrics || 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
    days: days || 28,
  });
}

async function searchVideos({ query, channelId, maxResults, order } = {}) {
  return callTool('youtube_search_videos', {
    query,
    channelId,
    maxResults: maxResults || 10,
    order: order || 'relevance',
  });
}

async function getTrending({ regionCode = 'DE', categoryId, maxResults = 10 } = {}) {
  // Not a first-class MCP tool yet — we approximate by searching for
  // "trending" + recent in the region. Returns whatever YouTube returns
  // for the videos.list?chart=mostPopular call.
  // (Will become a dedicated MCP tool later if we need it.)
  return callTool('youtube_search_videos', {
    query: categoryId ? `category:${categoryId}` : '',
    maxResults,
    order: 'viewCount',
  });
}

module.exports = {
  CHANNEL_ID,
  MCP_URL,
  MCP_HOST,
  MCP_PORT,
  health,
  callTool,
  getChannelStats,
  getVideoStats,
  getMyChannel,
  getMyRecentVideos,
  getMyAnalytics,
  searchVideos,
  getTrending,
};
