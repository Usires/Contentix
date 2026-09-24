#!/usr/bin/env node
/**
 * setup-oauth.js — Interactive OAuth setup for first-run and re-authentication.
 *
 * Usage:
 *   node scripts/setup-oauth.js              # interactive wizard
 *   node scripts/setup-oauth.js --check     # just print current state and exit
 *
 * Reads / writes:
 *   ../mcp-servers/youtube/.env              # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MCP_PORT
 *   ../mcp-servers/youtube/data/oauth-token.json
 *
 * Flow:
 *   1. Verify credentials in .env (print clear instructions if missing)
 *   2. Generate the Google OAuth URL with login_hint + scopes
 *   3. Print the URL; the user opens it in their browser, signs in, grants permissions
 *   4. Browser tries to redirect to localhost:<MCP_PORT>/auth/callback and fails
 *   5. User copies the FULL redirect URL (or just the `code=` value) from the address bar
 *   6. User pastes it back here; we exchange the code for tokens
 *   7. Tokens saved automatically; MCP server picks them up on next restart
 *
 * Why this design:
 *   - "Headless-server-friendly": no need for the browser to actually reach localhost,
 *     we read the code from the URL bar instead. Works over SSH tunnels.
 *   - "First-run-aware": detects missing credentials and gives exact next steps.
 *   - "Re-auth-aware": existing valid tokens are detected and you can choose to keep them.
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { existsSync, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const MCP_DIR = new URL('../mcp-servers/youtube/', import.meta.url);
const ENV_FILE = new URL('./.env', MCP_DIR).pathname;
const TOKEN_FILE = new URL('./data/oauth-token.json', MCP_DIR).pathname;

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const print = (msg) => console.log(msg);
const ask = async (q) => {
  const rl = createInterface({ input, output });
  const ans = await rl.question(q);
  rl.close();
  return ans.trim();
};

async function checkCurrentState() {
  print('\n=== Current OAuth state ===');
  if (!existsSync(ENV_FILE)) {
    print(`❌ .env not found at ${ENV_FILE}`);
    print('   → Run this script once after creating your Google Cloud OAuth client');
    return { credsOk: false, tokenExists: false };
  }
  const envContent = await readFile(ENV_FILE, 'utf-8');
  const hasClientId = /GOOGLE_CLIENT_ID=\S+/.test(envContent);
  const hasSecret = /GOOGLE_CLIENT_SECRET=\S+/.test(envContent);
  const tokenExists = existsSync(TOKEN_FILE);
  print(`   .env:        ${hasClientId && hasSecret ? '✅ credentials present' : '❌ missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET'}`);
  print(`   token file:  ${tokenExists ? '✅ oauth-token.json exists' : '❌ no token yet (first run)'}`);
  return { credsOk: hasClientId && hasSecret, tokenExists };
}

async function loadCredentials() {
  const env = await readFile(ENV_FILE, 'utf-8');
  const get = (key) => {
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    GOOGLE_CLIENT_ID: get('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: get('GOOGLE_CLIENT_SECRET'),
    MCP_PORT: get('MCP_PORT') || '8190',
  };
}

async function promptCredentials() {
  print('\n=== Google Cloud OAuth Client credentials ===');
  print('Create one at: https://console.cloud.google.com/apis/credentials');
  print('  1. Create (or select) a GCP project');
  print('  2. Enable "YouTube Data API v3" + "YouTube Analytics API"');
  print('  3. Create credentials → OAuth client ID → Application type: "Web application"');
  print(`  4. Authorized redirect URI: http://localhost:8190/auth/callback`);
  print('  5. Copy the Client ID and Client Secret below');
  print('');

  const clientId = await ask('GOOGLE_CLIENT_ID (paste, ends in .apps.googleusercontent.com): ');
  const clientSecret = await ask('GOOGLE_CLIENT_SECRET: ');
  const mcpPort = (await ask('MCP_PORT [8190]: ')) || '8190';

  // Persist to .env (preserve other lines)
  let existing = '';
  if (existsSync(ENV_FILE)) {
    existing = await readFile(ENV_FILE, 'utf-8');
  }
  const lines = existing.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && !/^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|MCP_PORT)=/.test(trimmed);
  });
  const updated = [
    ...lines,
    `GOOGLE_CLIENT_ID=${clientId}`,
    `GOOGLE_CLIENT_SECRET=${clientSecret}`,
    `MCP_PORT=${mcpPort}`,
  ].join('\n') + '\n';

  await mkdir(MCP_DIR.pathname, { recursive: true });
  await writeFile(ENV_FILE, updated);
  print(`✅ Wrote credentials to ${ENV_FILE}`);
  return { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, MCP_PORT: mcpPort };
}

async function exchangeCode(creds, code) {
  const oauth2 = new google.auth.OAuth2(
    creds.GOOGLE_CLIENT_ID,
    creds.GOOGLE_CLIENT_SECRET,
    `http://localhost:${creds.MCP_PORT}/auth/callback`
  );
  const { tokens } = await oauth2.getToken(code);
  await mkdir(new URL('./data/', MCP_DIR).pathname, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  return tokens;
}

async function interactiveFlow(creds) {
  const oauth2 = new google.auth.OAuth2(
    creds.GOOGLE_CLIENT_ID,
    creds.GOOGLE_CLIENT_SECRET,
    `http://localhost:${creds.MCP_PORT}/auth/callback`
  );
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',                 // forces a new refresh_token
    include_granted_scopes: true,
    login_hint: process.env.SETUP_OAUTH_LOGIN_HINT || undefined,
    scope: SCOPES,
  });

  print('\n=== STEP 1: Open this URL in your browser ===');
  print('(Locally on the same machine, over SSH tunnel, or on a phone — anywhere)');
  print('');
  print(url);
  print('');
  print('=== STEP 2: Sign in with the Google account that owns the YouTube channel ===');
  print('=== STEP 3: Grant the requested permissions ===');
  print(`=== STEP 4: The browser will fail to load (localhost:${creds.MCP_PORT} unreachable from browser) ===`);
  print('        That is expected. Copy the FULL URL from your address bar.');
  print('');
  print('Tip: You can also SSH-tunnel to the MCP server if it runs on a remote host:');
  print('  ssh -L ' + creds.MCP_PORT + ':localhost:' + creds.MCP_PORT + ' user@server');

  const answer = await ask('\nPaste the FULL redirect URL (or just the code= value): ');
  const codeMatch = answer.match(/[?&]code=([^&]+)/);
  const code = codeMatch ? decodeURIComponent(codeMatch[1]) : answer;
  if (!code || code.length < 20) {
    throw new Error('Could not extract a valid authorization code from the input.');
  }
  return code;
}

async function main() {
  print('╔════════════════════════════════════════════════════╗');
  print('║  Contentix OAuth setup                              ║');
  print('╚════════════════════════════════════════════════════╝');

  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    await checkCurrentState();
    return;
  }

  let state = await checkCurrentState();
  let creds = state.credsOk ? await loadCredentials() : null;

  if (!state.credsOk) {
    print('\nNo usable credentials found. Let\'s create them.');
    creds = await promptCredentials();
  }

  print('\nStarting OAuth flow...');
  const code = await interactiveFlow(creds);

  print('\nExchanging code for tokens...');
  try {
    const tokens = await exchangeCode(creds, code);
    print(`✅ Token saved to ${TOKEN_FILE}`);
    print(`   scope: ${tokens.scope}`);
    print(`   expires: ${new Date(tokens.expiry_date).toISOString()}`);
    print(`   refresh_token issued: ${!!tokens.refresh_token}`);
    print('');
    print('Next step: restart the MCP server so it picks up the new token:');
    print('   - If running via pm2: pm2 restart contentix-youtube-mcp');
    print('   - If running manually: kill the process and re-run `node server.js`');
    print('');
    print('Verify with: node scripts/check-oauth-health.js');
  } catch (err) {
    print(`\n❌ Token exchange failed: ${err.message}`);
    if (err.response) {
      print(`   Google response: ${JSON.stringify(err.response.data)}`);
    }
    print('   → Try running this script again. The code is single-use and may have expired.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
