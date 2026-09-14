/**
 * auth.js — OAuth + API-Key helpers for the YouTube MCP server
 *
 * Shared between tools.js (used by MCP tool handlers) and server.js (used by
 * the /auth and /auth/callback routes). Both modules import from here.
 *
 * Two auth modes:
 *   - API-Key (process.env.YOUTUBE_API_KEY): public data, no OAuth needed
 *   - OAuth (saved token in data/oauth-token.json): own channel + analytics
 */

import { google } from 'googleapis';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
export const TOKEN_FILE = path.join(DATA_DIR, 'oauth-token.json');
export const PORT = parseInt(process.env.MCP_PORT || '8190', 10);

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function makeOAuth2Client() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set.');
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    `http://localhost:${PORT}/auth/callback`
  );
}

export async function loadSavedToken() {
  if (!existsSync(TOKEN_FILE)) return null;
  try { return JSON.parse(await readFile(TOKEN_FILE, 'utf8')); } catch { return null; }
}

export async function saveToken(token) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf8');
}

export function hasValidToken(token) {
  return !!(token && token.refresh_token);
}

export async function getAuthenticatedOAuth2() {
  const oauth2 = makeOAuth2Client();
  const saved = await loadSavedToken();
  if (!hasValidToken(saved)) {
    throw new Error(
      'No saved OAuth token. Visit http://localhost:' + PORT + '/auth to start login flow.'
    );
  }
  oauth2.setCredentials(saved);
  oauth2.on('tokens', async (newTokens) => {
    if (newTokens.refresh_token) saved.refresh_token = newTokens.refresh_token;
    if (newTokens.access_token) saved.access_token = newTokens.access_token;
    if (newTokens.expiry_date) saved.expiry_date = newTokens.expiry_date;
    await saveToken(saved);
  });
  return oauth2;
}

export function youtubeApiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY not set.');
  return google.youtube({ version: 'v3', auth: key });
}

export async function youtubeOAuth(auth = null) {
  const oauth2 = auth || (await getAuthenticatedOAuth2());
  return google.youtube({ version: 'v3', auth: oauth2 });
}

export async function youtubeAnalytics(auth = null) {
  const oauth2 = auth || (await getAuthenticatedOAuth2());
  return google.youtubeAnalytics({ version: 'v2', auth: oauth2 });
}
