#!/usr/bin/env node
/**
 * check-oauth-health.js — OAuth token health check for the YouTube MCP server.
 *
 * Usage:
 *   node scripts/check-oauth-health.js               # human-readable status
 *   node scripts/check-oauth-health.js --json       # JSON output (for scripts/Uptime-Kuma)
 *   node scripts/check-oauth-health.js --exit-code  # exit 0 = healthy, 1 = expired, 2 = missing
 *
 * Reads the same `oauth-token.json` and `.env` that the MCP server uses,
 * calls YouTube's cheapest authenticated endpoint (channels.list?part=id&mine=true)
 * and reports the status.
 *
 * Exit codes (with --exit-code):
 *   0 = healthy (token works, expires in >7 days)
 *   1 = expired or revoked (needs re-auth)
 *   2 = no token file (first-run setup needed)
 *   3 = missing credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not in .env)
 *   4 = network error / YouTube API unreachable
 */

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { google } from 'googleapis';

const MCP_DIR = new URL('../mcp-servers/youtube/', import.meta.url);
const TOKEN_FILE = new URL('./data/oauth-token.json', MCP_DIR).pathname;
const ENV_FILE = new URL('./.env', MCP_DIR).pathname;

// Load the MCP server's .env explicitly so we don't depend on cwd.
if (existsSync(ENV_FILE)) {
  dotenvConfig({ path: ENV_FILE });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function probe(auth) {
  const youtube = google.youtube({ version: 'v3', auth });
  // Cheapest authenticated call that proves the token works.
  const res = await youtube.channels.list({ part: 'id', mine: true, maxResults: 1 });
  return res.data.items?.[0]?.id || null;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const exitCodeMode = args.includes('--exit-code');

  const result = { status: 'unknown', message: '', details: {} };

  // 1. Credentials check
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    result.status = 'no_credentials';
    result.message = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in .env';
    output(result, jsonMode);
    if (exitCodeMode) process.exit(3);
    return;
  }

  // 2. Token file check
  if (!existsSync(TOKEN_FILE)) {
    result.status = 'missing';
    result.message = `No token file at ${TOKEN_FILE}. Run setup-oauth.js to start the OAuth flow.`;
    output(result, jsonMode);
    if (exitCodeMode) process.exit(2);
    return;
  }

  const tokens = readJson(TOKEN_FILE);
  const now = Date.now();
  const expiresAt = tokens.expiry_date || 0;
  const expiresInDays = expiresAt ? Math.round((expiresAt - now) / 86_400_000) : null;

  result.details.tokenExpiresInDays = expiresInDays;
  result.details.hasRefreshToken = !!tokens.refresh_token;
  result.details.scope = tokens.scope;

  // 3. Probe with current access_token (if not expired)
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials(tokens);

  try {
    const channelId = await probe(oauth2);
    if (expiresInDays !== null && expiresInDays <= 0) {
      result.status = 'access_expired';
      result.message = `Access token expired, but refresh works. Refresh token still valid.`;
    } else if (expiresInDays !== null && expiresInDays <= 7) {
      result.status = 'expiring_soon';
      result.message = `Token works, but expires in ${expiresInDays} day(s). Consider re-auth soon.`;
    } else {
      result.status = 'healthy';
      result.message = `OAuth healthy. Channel: ${channelId || 'unknown'}. Token valid for ${expiresInDays} more day(s).`;
    }
  } catch (err) {
    const code = err.code || err.response?.status;
    if (code === 401 || /invalid_grant|revoked|expired/i.test(err.message || '')) {
      result.status = 'expired';
      result.message = `OAuth token rejected by YouTube: ${err.message}`;
    } else {
      result.status = 'network_error';
      result.message = `Cannot reach YouTube API: ${err.message}`;
    }
  }

  output(result, jsonMode);

  if (exitCodeMode) {
    const codeMap = { healthy: 0, expiring_soon: 0, access_expired: 1, expired: 1, missing: 2, no_credentials: 3, network_error: 4, unknown: 4 };
    process.exit(codeMap[result.status] ?? 4);
  }
}

function output(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const icon = {
    healthy: '✅',
    expiring_soon: '⚠️ ',
    access_expired: '⚠️ ',
    expired: '❌',
    missing: '🆕',
    no_credentials: '🔧',
    network_error: '🌐',
    unknown: '❓',
  }[result.status] || '·';
  console.log(`${icon}  [${result.status}] ${result.message}`);
  if (result.details.tokenExpiresInDays !== undefined) {
    console.log(`    Token expires in: ${result.details.tokenExpiresInDays} day(s)`);
  }
  if (result.details.hasRefreshToken === false) {
    console.log(`    ⚠️  No refresh token — re-auth required on next expiry`);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(4);
});
