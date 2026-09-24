#!/usr/bin/env node
/**
 * Contentix YouTube MCP Server
 *
 * Exposes YouTube Data API v3 + YouTube Analytics as MCP tools.
 * Two transports:
 *   - MCP over SSE (/sse, /messages) for MCP-aware clients
 *   - HTTP POST /tool/:name for simple HTTP callers (Contentix, OpenClaw agents)
 *
 * Two auth modes (handled inside tools.js):
 *   - API-Key (public data: any channel, any video)
 *   - OAuth (private: own channel, analytics, watchtime, real-time)
 */

import 'dotenv/config';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { TOOLS, callTool } from './tools.js';
// OAuth + token storage helpers are imported from auth.js (shared with tools.js)
import { makeOAuth2Client, loadSavedToken, hasValidToken, saveToken, SCOPES, TOKEN_FILE, PORT } from './auth.js';

// ─── MCP server (re-uses the tool implementations from tools.js) ────────────

const server = new McpServer({
  name: 'contentix-youtube',
  version: '0.1.0',
});

// Register each tool from tools.js with the MCP SDK
for (const [name, { handler, description, inputSchema }] of Object.entries(TOOLS)) {
  // Convert JSON Schema to zod raw shape so SDK accepts it
  const zodShape = jsonSchemaToZodRaw(inputSchema);
  server.tool(name, zodShape, async (args) => handler(args));
}

function jsonSchemaToZodRaw(schema) {
  // Minimal converter for our tool schemas (only string/number/enum/required).
  // Anything we don't handle here is passed as-is, and the MCP SDK's validator
  // does the rest. Keep this conservative.
  const shape = {};
  const props = schema.properties || {};
  for (const [key, def] of Object.entries(props)) {
    if (def.enum) {
      shape[key] = z.enum(def.enum).optional();
    } else if (def.type === 'number') {
      shape[key] = z.number().optional();
    } else {
      shape[key] = z.string().optional();
    }
  }
  return shape;
}

// ─── HTTP server: OAuth + /tool/:name + SSE transport ──────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'contentix-youtube-mcp', version: '0.1.0' });
});

// HTTP shortcut for non-MCP clients (Contentix, OpenClaw agents, curl, etc.)
// POST /tool/<tool-name>  with  {"arguments": {...}}
// Returns: { content: [...], isError?: bool }
app.post('/tool/:name', async (req, res) => {
  const name = req.params.name;
  const args = req.body?.arguments ?? req.body ?? {};
  const result = await callTool(name, args);
  res.json(result);
});

// OAuth flow: visit /auth in browser, grant, token saved automatically
import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TOKEN_FILE, SCOPES, makeOAuth2Client, loadSavedToken, hasValidToken are all
// imported from ./auth.js (shared with tools.js)
const DATA_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/data';

app.get('/auth', async (_req, res) => {
  try {
    const oauth2 = makeOAuth2Client();
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
    res.redirect(url);
  } catch (err) {
    res.status(500).send('OAuth init failed: ' + err.message);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('Missing ?code= from Google');
    const oauth2 = makeOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(500).send('No refresh_token. Try /auth again and grant all permissions.');
    }
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    res.send(
      '<h1>✅ OAuth complete</h1>' +
      '<p>Refresh token saved to <code>' + TOKEN_FILE + '</code></p>' +
      '<p>You can close this tab. The MCP server will auto-refresh access tokens from now on.</p>'
    );
  } catch (err) {
    res.status(500).send('OAuth callback failed: ' + err.message);
  }
});

app.get('/auth/status', async (_req, res) => {
  const saved = await loadSavedToken();
  res.json({
    oauthConfigured: hasValidToken(saved),
    tokenFile: TOKEN_FILE,
    hasRefreshToken: !!saved?.refresh_token,
    hasAccessToken: !!saved?.access_token,
    accessTokenExpiry: saved?.expiry_date ? new Date(saved.expiry_date).toISOString() : null,
  });
});

// Live OAuth health: actually calls YouTube's cheapest authenticated endpoint
// (channels.list?part=id&mine=true). Suitable for Uptime-Kuma HTTP monitors —
// 200 = healthy, 503 = needs re-auth. Always JSON, never throws.
app.get('/health/oauth', async (_req, res) => {
  const result = {
    status: 'unknown',
    message: '',
    details: {},
    checkedAt: new Date().toISOString(),
  };
  try {
    const saved = await loadSavedToken();
    if (!saved) {
      result.status = 'missing';
      result.message = 'No oauth-token.json. Run: node scripts/setup-oauth.js';
      return res.status(503).json(result);
    }
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      result.status = 'no_credentials';
      result.message = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing in .env';
      return res.status(503).json(result);
    }
    const auth = makeOAuth2Client();
    auth.setCredentials(saved);
    const youtube = google.youtube({ version: 'v3', auth });
    const res2 = await youtube.channels.list({ part: 'id', mine: true, maxResults: 1 });
    const channelId = res2.data.items?.[0]?.id || null;
    const now = Date.now();
    const expiresAt = saved.expiry_date || 0;
    const expiresInDays = expiresAt ? Math.round((expiresAt - now) / 86_400_000) : null;
    // Save any auto-refreshed token back to disk so the next MCP call doesn't repeat the refresh.
    if (auth.credentials && auth.credentials.access_token !== saved.access_token) {
      try {
        await saveToken(auth.credentials);
      } catch (_) { /* non-fatal */ }
    }
    result.details.channelId = channelId;
    result.details.scope = saved.scope;
    result.details.tokenExpiresInDays = expiresInDays;
    result.details.accessTokenJustRefreshed = !!auth.credentials?.access_token && auth.credentials.access_token !== saved.access_token;
    // If the live call succeeded, the OAuth flow is healthy — regardless of whether the
    // stored expiry date looks stale. The refresh_token auto-renews the access_token.
    if (expiresInDays !== null && expiresInDays <= 7 && result.details.accessTokenJustRefreshed) {
      // Refresh worked, but warn the user that the refresh-token itself is approaching expiry.
      result.status = 'expiring_soon';
      result.message = `OAuth works (access token auto-refreshed). Refresh token valid for ~${expiresInDays} day(s). Run setup-oauth.js soon to be safe.`;
      return res.status(200).json(result);
    }
    if (expiresInDays !== null && expiresInDays <= 7) {
      result.status = 'expiring_soon';
      result.message = `Token works, but expires in ${expiresInDays} day(s). Consider re-auth soon.`;
      return res.status(200).json(result);
    }
    result.status = 'healthy';
    result.message = `OAuth healthy. Channel ${channelId || 'unknown'}. Token valid for ${expiresInDays} more day(s).`;
    return res.status(200).json(result);
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 401 || /invalid_grant|revoked|expired/i.test(err.message || '')) {
      result.status = 'expired';
      result.message = `OAuth token rejected: ${err.message}`;
      return res.status(503).json(result);
    }
    result.status = 'error';
    result.message = `Health check failed: ${err.message}`;
    return res.status(503).json(result);
  }
});

// MCP transport via SSE
const transports = new Map();
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => transports.delete(transport.sessionId));
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) return res.status(400).send('No transport for sessionId');
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`[youtube-mcp] HTTP server listening on http://localhost:${PORT}`);
  console.log(`[youtube-mcp]   Health:    http://localhost:${PORT}/health`);
  console.log(`[youtube-mcp]   OAuth:     http://localhost:${PORT}/auth`);
  console.log(`[youtube-mcp]   Auth OK:   http://localhost:${PORT}/auth/status`);
  console.log(`[youtube-mcp]   Tool call: POST http://localhost:${PORT}/tool/<name>`);
  console.log(`[youtube-mcp]   MCP SSE:   http://localhost:${PORT}/sse`);
});

process.on('SIGTERM', () => { console.log('[youtube-mcp] SIGTERM'); process.exit(0); });
process.on('SIGINT', () => { console.log('[youtube-mcp] SIGINT'); process.exit(0); });
