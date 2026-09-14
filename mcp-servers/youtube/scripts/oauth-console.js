#!/usr/bin/env node
/**
 * Console-based OAuth setup for headless / non-browser environments.
 * 
 * Usage:
 *   1. Run this script: node scripts/oauth-console.js
 *   2. Copy the printed URL into your browser (on ANY device)
 *   3. Complete Google login
 *   4. The redirect will FAIL (can't reach localhost:8190 from browser)
 *      BUT the URL bar will show: http://localhost:8190/auth/callback?code=XXXX&scope=...
 *   5. Copy the FULL redirected URL from your browser
 *   6. Paste it back into this script
 *   7. Token gets saved automatically
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'oauth-token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
];

async function main() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MCP_PORT = '8190' } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env');
    process.exit(1);
  }
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    `http://localhost:${MCP_PORT}/auth/callback`
  );
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
  console.log('\n=== STEP 1: Copy this URL into your browser ===');
  console.log('(On your CachyOS, phone, wherever)\n');
  console.log(url);
  console.log('\n=== STEP 2: Sign in & grant permissions ===');
  console.log('=== STEP 3: Browser will fail to load (cannot reach localhost:8190) ===');
  console.log('        That\'s OK! Copy the FULL URL from your address bar.\n');

  const rl = createInterface({ input, output });
  const answer = await rl.question('Paste the FULL redirect URL here (or just the code): ');
  rl.close();

  let code;
  if (answer.includes('code=')) {
    const params = new URL(answer.trim()).searchParams;
    code = params.get('code');
  } else {
    code = answer.trim();
  }

  if (!code) {
    console.error('No code found in input. Aborting.');
    process.exit(1);
  }

  console.log('\nExchanging code for tokens...');
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('No refresh_token in response. Did you already grant before? Re-run with --reset');
    process.exit(1);
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  console.log('\n✅ Token saved to', TOKEN_FILE);
  console.log('   Access token expires:', new Date(tokens.expiry_date).toISOString());
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
