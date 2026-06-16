# Vidi — YouTube Research Agent

**Vidi** is the YouTube-research subagent that powers Contentix's
1-click research button. It runs as an OpenClaw agent, has its own
identity, and uses the vidIQ MCP for all data collection.

This document explains what Vidi is, how it integrates with
Contentix, and how to operate it.

---

## TL;DR

Vidi is a **scout**, not a coach. It gathers data and quotes
sources. Strategic recommendations and creative direction are Nix's
job (the main agent in the same OpenClaw gateway). The 1-click
button on every Kanban card in Contentix spawns a Vidi run, streams
progress into the UI, and writes the final report into the card's
`nix_comment` field. The result is then rendered in a modal the
creator can read, copy, or expand into a script.

---

## Roles

| Agent | Role | Output |
|-------|------|--------|
| **Vidi** (this agent) | Research scout | Data tables, outlier lists, channel comparisons, keyword metrics, source quotes |
| **Nix** (main agent) | Strategist + builder | Recommendations, scripts, plans, blog posts, system architecture |

The split is intentional: Vidi doesn't know Dirk well enough to
coach, and Nix doesn't want to spend tokens scraping vidIQ. They
talk to each other in the main session, never directly to the
user for strategic work.

---

## Architecture

```
Contentix Browser
   │  (Kanban: click 🔭 Vidi-Research on a card)
   ▼
Contentix Backend  ── POST /api/research/:videoId
   │  (holds OpenClaw gatewayUrl + token in .env)
   ▼
OpenClaw Gateway  ── spawns agent "youtubebot" (Vidi)
   │  (Vidi runs the research with vidIQ MCP tools)
   ▼
vidIQ MCP         ── returns channel/video/keyword/outlier data
   │
   ▼
Vidi Synthesizes  ── writes progress + final report
   │  (POST /api/research/:jobId/progress  and  POST /api/research/:jobId/final)
   ▼
Contentix DB      ── nix_comment + research_jobs.progress_message
   │
   ▼
Contentix Browser (Kanban modal renders the final report)
```

Vidi does **not** write to disk. Contentix is the system of record
for research results; Vidi's job ends when it has POSTed the
synthesized report to Contentix.

---

## How a run works

1. **User clicks 🔭 Vidi-Research** on a Kanban card.
2. Contentix backend creates a `research_jobs` row with status
   `pending`, returns a `jobId` to the browser.
3. The backend spawns the OpenClaw agent:
   ```bash
   openclaw agent --agent youtubebot \
     --message "Research video <title>, <video_id>..." \
     --timeout 1800
   ```
4. Vidi is given:
   - The video title and ID
   - The channel name
   - Any existing card notes (`videos.notes`)
   - A unique `jobId` it must include in progress POSTs
5. Vidi runs its research loop, calling vidIQ MCP tools:
   - `vidiq_keyword_research` → keyword volume / competition
   - `vidiq_outliers` → top-performing videos in the niche
   - `vidiq_trending_videos` → currently hot videos
   - `vidiq_channel_stats` / `vidiq_channel_analytics` → channel KPIs
   - `vidiq_video_stats` / `vidiq_video_transcript` → video details
6. As Vidi works, it POSTs progress every ~20s:
   ```json
   POST /api/research/:jobId/progress
   { "phase": "🔍 Recherche Keywords…", "elapsed_s": 42 }
   ```
   The frontend polls `GET /api/research/:jobId` and shows the
   current phase in a toast.
7. When Vidi finishes, it POSTs the final report:
   ```json
   POST /api/research/:jobId/final
   { "report_markdown": "...", "nix_comment": "..." }
   ```
   Contentix stores both in the `research_jobs` table and copies
   the `nix_comment` to the originating video's `nix_comment` field.
8. The browser shows a modal with the report; the user can close
   it, copy it, or click through to the script editor.

If Vidi fails (timeout, MCP error, etc.), Contentix marks the job
`failed` and shows the error. Re-trying is one click.

---

## Vidi's identity

Vidi is intentionally narrow:

- **Scout, not coach.** It brings data; it does not recommend
  topics, titles, or strategies. Recommendations are Nix's job in
  the main session.
- **Quoting scout.** When Vidi makes a claim, it cites the source
  (channel, video, vidIQ metric). No invented numbers.
- **Bilingual.** German (Dirk's native language) and English
  (vidIQ source language). Default to German for the report; keep
  English for technical terms (thumbnail, breakout score, VPH).
- **No flattery.** Vidi doesn't say "great idea" or "this will
  work". It says what the data shows and where the uncertainty is.

Vidi's full identity lives in OpenClaw's
`agents/youtubebot/{IDENTITY,SOUL,USER}.md`. The summary above is
the part the Contentix user needs to know.

---

## Costs and limits

Each Vidi run consumes:

- **Time:** 1–4 minutes typical, 30 minutes max (OpenClaw timeout)
- **vidIQ credits:** 5–25 depending on how many MCP calls Vidi
  needs. A minimal "channel + 3 outliers" run is ~15 credits.
  A keyword-research + outlier + channel-analytics run can be 40+.
- **OpenClaw tokens:** 5–20k tokens for the full synthesised report

A cooldown of 60 seconds between runs on the same card prevents
accidental credit-spam. There's no global rate limit; the operator
(Dirk) is responsible for not running Vidi 50 times in a row.

---

## Operational notes

- The OpenClaw gateway URL and token live in Contentix's `.env`:
  ```
  OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
  OPENCLAW_GATEWAY_TOKEN=<token from openclaw.json>
  ```
- If Vidi's button does nothing, check the gateway is reachable:
  ```bash
  curl -sf "$OPENCLAW_GATEWAY_URL/health" || echo "gateway down"
  ```
- If vidIQ stats come back as `0` or `401`, the vidIQ MCP key in
  OpenClaw is expired. Get a new one from the vidIQ dashboard and
  update `openclaw.json` → `mcp.servers.vidIQ.headers.Authorization`,
  then restart the gateway.
- Vidi's research reports are stored in `research_jobs.report_markdown`
  for the lifetime of the row. They are not auto-deleted.

---

## Why a separate agent?

Putting research into a subagent gives us three things the main
session can't:

1. **Isolation.** A 200k-context M3 call for a 10-minute research
   loop is overkill. Vidi runs on a small local model — sub-second
   per call, no per-token cost, and the main session keeps its
   context for the actual work.
2. **Specialisation.** Vidi's SOUL, IDENTITY and USER docs are
   tuned for "find me data" — not "what should I do?". The narrow
   role keeps the responses focused and the prompts small.
3. **Credit control.** VidIQ charges per MCP call. Putting the
   calls behind a subagent makes it easy to log every call and
   to enforce the per-card cooldown.

---

_By Nix 🐧 & Dirk, 2026. Vidi is alive._
