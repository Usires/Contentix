# YouTube OAuth Setup for Contentix

Contentix talks to YouTube via the **YouTube Data API v3** and the **YouTube Analytics API**. To fetch your own channel's videos, watchtime, and analytics, you need OAuth credentials that Google recognises as your own application.

This guide walks you through:

1. Creating a Google Cloud project with the right APIs enabled
2. Creating an OAuth client ID
3. Configuring Contentix with those credentials
4. Completing the one-time browser-based consent flow
5. Verifying everything works
6. Keeping the credentials fresh over time

Total setup time: ~15 minutes. You only do this once per installation.

---

## 1. Create a Google Cloud project (if you don't have one)

1. Open https://console.cloud.google.com/
2. Click the project dropdown at the top → **New project**
3. Name it something like `contentix-youtube` → **Create**
4. Wait a few seconds for the project to be created

> **Billing note:** YouTube Data API v3 has a free quota of **10,000 units/day**. Contentix typically uses <500 units/day for normal operation (1 channel.list call ≈ 1 unit, 1 video.list call ≈ 1 unit). You will NOT be billed unless you explicitly enable billing in the Google Cloud Console.

---

## 2. Enable the required APIs

In your project:

1. Go to **APIs & Services → Library** (left sidebar)
2. Search for **YouTube Data API v3** → click → **Enable**
3. Back to Library, search for **YouTube Analytics API** → click → **Enable**

---

## 3. Configure the OAuth consent screen

Before creating credentials, Google wants to know what your app looks like to users.

1. Go to **APIs & Services → OAuth consent screen** (left sidebar)
2. User type: **External** (unless you have a Google Workspace org and want to limit to your org)
3. Fill in the required fields:
   - **App name:** `Contentix` (or whatever you prefer)
   - **User support email:** your email
   - **Developer contact email:** your email
4. **Scopes:** add these three:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. **Test users:** add your own Google account email (the one that owns the YouTube channel). This avoids Google's "unverified app" warning.
6. **Save**

> **About the "unverified app" screen:** While your app is in "Testing" mode (before you submit it for Google's verification, which is optional), only the test users you added can complete the OAuth flow. If you see a scary red "unverified app" warning when running setup-oauth.js, click "Advanced" → "Go to Contentix (unsafe)". This is normal for personal projects.

---

## 4. Create OAuth client credentials

1. Go to **APIs & Services → Credentials** (left sidebar)
2. Click **+ Create credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Contentix MCP` (or whatever)
5. **Authorized redirect URIs** → **Add URI**:
   ```
   http://localhost:8190/auth/callback
   ```
   > If you run Contentix on a remote server, you might also need a tunneled URI, but for the setup flow the local one is enough — see step 6 for how to do the OAuth dance over SSH.
6. **Create**
7. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**

---

## 5. Run the setup wizard

Contentix ships with an interactive setup script that asks for your Client ID and Client Secret, generates the OAuth URL, and exchanges the resulting authorization code for tokens.

```bash
cd /path/to/contentix
npm install        # if you haven't already
npm run oauth:setup
```

The wizard will:
1. Ask for your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (it saves them to `mcp-servers/youtube/.env`)
2. Print a Google OAuth URL
3. Wait for you to paste back the redirect URL (or just the `code=...` part)
4. Save the resulting token to `mcp-servers/youtube/data/oauth-token.json`

---

## 6. Completing the browser consent (with or without SSH tunnel)

This is the part that confuses most people, so we'll go through it step by step.

### Scenario A: Contentix runs on your laptop

1. Copy the OAuth URL the wizard printed
2. Paste it into your browser
3. Sign in with the Google account that owns the YouTube channel
4. Click **Allow** on the consent screen
5. Your browser tries to load `http://localhost:8190/auth/callback` and fails (the MCP server isn't running, or the URL is wrong) — **this is expected, ignore the error**
6. Copy the **FULL URL from the browser's address bar** (it starts with `http://localhost:8190/auth/callback?code=...&scope=...`)
7. Paste it back into the wizard
8. ✅ Token saved

### Scenario B: Contentix runs on a remote server

You'll need an SSH tunnel so your local browser can reach the MCP server's callback URL:

1. On your local machine (laptop), open a terminal and forward the MCP port:
   ```bash
   ssh -L 8190:localhost:8190 user@your-server
   ```
   Keep this terminal open.

2. Open your browser on your local machine

3. Copy the OAuth URL from the wizard (still running on the server) and paste into your local browser

4. The browser tries to load `http://localhost:8190/auth/callback` — and because of your SSH tunnel, **the redirect now actually works**. You'll see a JSON response like `{"ok":true,"received":true,"saved":true}`.

   > **If you see "connection refused" instead**, your MCP server isn't running on the server. Start it (`cd mcp-servers/youtube && node server.js`) and try again.

5. **Either way**, the wizard now has the `code` from the redirect URL. The token is saved automatically.

   If your browser showed the JSON response from the running MCP server, the setup is already complete — you can just press Enter (or type anything) and the wizard will finish.

   If your browser showed a "connection refused" or similar error, the wizard needs the URL from the address bar. Copy it back into the wizard.

### Scenario C: Headless server, no SSH tunnel available

Same as Scenario B, but instead of an SSH tunnel, you use a temporary public tunnel like `ngrok`:

1. On the server, start the MCP server (`cd mcp-servers/youtube && node server.js`)
2. In another terminal on the server, run `ngrok tcp 8190`
3. Use the ngrok URL the wizard prints as the basis for your OAuth URL — but **the redirect URI must be `http://localhost:8190/auth/callback`** (which is what you configured in step 4)
4. This works because the wizard's redirect URL points to localhost, and ngrok makes localhost accessible from the browser

In all three scenarios, the wizard ends with a token file at `mcp-servers/youtube/data/oauth-token.json`. ✅

---

## 7. Verify it works

```bash
npm run oauth:check
```

You should see something like:

```
✅  [healthy] OAuth healthy. Channel UCxxxxxxxxxxxxxx. Token valid for 57 more day(s).
    Token expires in: 57 day(s)
```

You can also hit the HTTP health endpoint:

```bash
curl http://localhost:8190/health/oauth
```

This is suitable for Uptime-Kuma or any other HTTP monitor — it returns:
- `200 OK` with `status: "healthy"` or `status: "expiring_soon"` if the token works
- `503 Service Unavailable` with `status: "expired"` if the token has been revoked by Google
- `503 Service Unavailable` with `status: "missing"` if no token file exists yet

---

## 8. Keeping credentials fresh

OAuth refresh tokens are long-lived (typically 6 months of inactivity before Google revokes them), but they **can** be revoked if:

- You remove the app from your Google account settings
- The Google Cloud project is deleted
- You change the OAuth client ID/Secret
- Google revokes the token for security reasons

When that happens, just re-run `npm run oauth:setup` and complete the consent flow again. Your existing data in Contentix is preserved.

### Suggested monitoring setup (Uptime-Kuma)

1. Add a new monitor → Type: **HTTP(s)**
2. URL: `http://your-contentix-host:8190/health/oauth`
3. Expected status code: `200`
4. Interval: `60 minutes` (the endpoint is cheap, you can do every 5 minutes if you want)

If the monitor ever goes red, you'll get a notification before you notice that "new videos aren't showing up in Contentix".

---

## Frequently Asked Questions

### Why doesn't Contentix just have a "Login with Google" button in the web UI?

OAuth requires a redirect URI that Google can call back. In a normal web app, that URI is your public website. In Contentix, the OAuth client is the local MCP server, which is **per-user, per-installation** — different from the public web UI. Putting the OAuth dance in the CLI keeps the security model simple: only the person who can SSH into the box can grant access to that box's Google account.

### Why not a Service Account?

Service accounts work great for **public data** (any channel, any video), but they're not allowed to access **user-private data** like your own YouTube channel's analytics or watchtime. For Contentix's use case (which is "show me MY channel's videos and analytics"), there's no Service Account alternative — you need a User OAuth flow.

### My refresh token keeps expiring every few days, why?

This is almost always because Google's **OAuth consent screen** has your app in "Testing" mode AND you have a **short refresh-token TTL** set in your Google Workspace admin settings. Either:
- Submit your app for Google's verification (production access = refresh tokens that don't expire on inactivity)
- Or set up a personal-use "internal" OAuth scope if your Google Workspace allows it
- Or accept that you'll re-auth every 30 days — at that point just add `npm run oauth:setup` to your calendar

### I see "The OAuth client was not found" when I open the URL

Either:
- The Client ID in your `.env` is wrong (copy-paste error — check for trailing whitespace)
- The Google Cloud project was deleted
- You're signed into a different Google account than the one that owns the YouTube channel

Try running `npm run oauth:check` to see what your current credentials look like.

---

## Files touched by the OAuth flow

```
contentix/
├── .env                                  # never committed, see .gitignore
├── mcp-servers/youtube/
│   ├── .env                              # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MCP_PORT
│   └── data/
│       └── oauth-token.json              # refresh_token, access_token, expiry_date
├── scripts/
│   ├── setup-oauth.js                    # the wizard
│   └── check-oauth-health.js             # CLI status check
└── docs/
    └── oauth-setup.md                     # this file
```
