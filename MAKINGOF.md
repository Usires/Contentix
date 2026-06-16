# MAKINGOF.md — Contentix

*How a Kanban-board clone turned into a YouTube content planner — by Nix 🐧 & Dirk, 2026.*

---

## What is Contentix?

**Contentix** is a self-hosted Kanban + Calendar + Script editor for
YouTube creators, with vidIQ stats baked in. It plans videos, drafts
scripts, archives old work, and (since v0.10) can hand off research
questions to a Vidi AI agent and stream the result back.

Single user, local-first, MIT-licensed. The whole thing is a single
Node.js process and one SQLite file.

---

## How it started

Dirk needed a content-planning tool. He'd been running his YouTube
channel off a mix of Notion boards, Google Docs and a paper notebook,
and the seams were starting to show.

The first version was the Phase-1 MVP from April 2026 — a 5-endpoint
Node app, a calendar view, no Kanban. The plan was just "give me
something that doesn't live in three places at once".

It lasted about 36 hours.

---

## The "Board ist King" pivot

Once Dirk actually used Phase 1, the problem became obvious: his
editorial workflow is **status-driven**, not date-driven. A video is
"in research" or "in script" or "ready to record" — and the *date*
falls out of that, not the other way around. The calendar was making
him re-tag the same video three times as it moved through his head.

So we tore out the calendar-first design and replaced it with a
Kanban-first one. 5 columns, drag-and-drop, status as the source of
truth.

**The funny part:** we didn't start from scratch. We took the
**kanban-board structure from NixBoard** (Dirk's general-purpose
task board, originally built in February 2026) and re-skinned it for
content. Same column machinery, same drag-and-drop, same
modal-editor pattern — but a different database, different
fields, different vocabulary. We called it "mix of inspiration and
reuse", because forking the whole repo would have been heavier than
it deserved, and starting from nothing would have wasted 6 weeks of
NixBoard battle-testing.

**The honest part:** NixBoard and Contentix share a *vibe* (Kanban,
modal editor, themable, seasonal palettes) but **not code**.
Contentix's `index.js` is its own thing — different routes, different
schema, different MCP integrations. The board CSS and the column-
to-status mapping are the only real shared DNA.

---

## The "krassen Sessions"

Once the Kanban pivot was in, we sat down and built the rest in a
single manic weekend in early June 2026. The git log tells the
story:

```
2026-06-03  Initial commit: Contentix v0.9.1 (30 files, 9 527 lines)
2026-06-03  Make status pipeline interactive + document 6-value schema
2026-06-03  Auto-focus first input field in modals + bundle missed CHANGELOG
2026-06-03  Phase 1 keyboard shortcuts: +, 1-5, Cmd+K, Cmd+Enter, ? help
2026-06-03  Sidebar rework: move next-video widget to top + theme-aware colors
2026-06-03  Sidebar: --text-on-dark-secondary token per theme
2026-06-03  Sidebar: extra spacing between channel name and next-video widget
2026-06-03  Author-Icon = Emoji (🐧 Nix, 🎬 Dirk) instead of doubled name
2026-06-03  Kanban: CSS for .kanban-card__date
2026-06-03  Kanban: Geplantes Datum auf Cards ('📅 TT/MM' or 'Ungeplant')
2026-06-03  Datum-Format auf 'TT.MM.' vereinheitlichen
2026-06-03  Skript-Druckansicht: iframe-Print + @media print CSS
2026-06-03  Contentix: Owner-Feld im Card-Modal + LÖSCHEN/ARCHIV-Button
2026-06-03  Library: .video-row .title with max-width: 100% + display: block
2026-06-03  Kalender: Datum + Author zu Event-Cards hinzufügen
2026-06-03  CHANGELOG: bump to 0.9.7 entry
2026-06-03  Sidebar: add --text-on-dark-secondary token for dark surfaces
```

That's 16 commits on a single day, all working features. This is
what "krass" looks like in a git log: a streak of small, confident
touches — one tiny improvement at a time, no big bang, no broken
states. Just momentum.

Why does that work? Two reasons:

1. **Small commits are safe commits.** A 5-line CSS tweak is easy to
   review, easy to revert, easy to talk about. A 500-line "new
   feature" is none of those.
2. **The codebase is small enough to hold in your head.** Once you
   know the 6 status values and the 5 column IDs, every commit is
   obvious. We didn't have to think — we just had to type.

---

## The "Vidi handoff" — v0.10

After the June sprint, Contentix settled into "feature-complete for
one person". Then in mid-June 2026, the OpenClaw ↔ Vidi agent
infrastructure got good enough that we could wire it in.

The idea: a button on every Kanban card. Click it, and a Vidi AI
agent researches the topic, drafts a script outline, and pushes the
script back into Contentix — all in under 4 minutes, with a live
progress bar.

This was the first time Contentix had an **async, long-running,
external-service-backed feature** in the API. It forced some real
engineering:

- A `research_jobs` table (status, progress, result, error, timing).
- A cooldown so you don't burn vidIQ credits on accidental
  double-clicks.
- A cancel endpoint, because waiting 4 minutes for a research you
  started by mistake is not OK.
- A polling endpoint, because Vidi runs as a separate OpenClaw
  agent and we can't keep an HTTP request open for 4 minutes.
- A `marked.js` + `DOMPurify` markdown renderer in the modal,
  because Vidi's reports have tables and headings.
- A stderr-streamed progress pipe, so the UI can show "🔍 Recherche
  läuft…" instead of static "Spawning…".

The whole feature shipped in **two days**, end-to-end, including the
playwright tests. That's what 7 weeks of build-up buys you: when
the architecture is right, the new feature slots in.

---

## Decisions we kept

| Decision | Why we kept it |
|----------|----------------|
| **Port 3038** (not 80/443) | Reverse-proxy friendly, doesn't conflict with NixBoard on 3036. |
| **sql.js** (not `better-sqlite3`) | No native compilation, no `node-gyp`, no `apt install build-essential`. Just `npm install` and go. |
| **Vanilla JS + CSS** (no React, no Vue) | The codebase fits in one head. Adding a framework would cost more than it saves at this size. |
| **5 themes** (Nix Violet default + 4 seasonal) | Because Dirk's been a NixBoard user for 4 months and we already had the token set. |
| **Soft archive** (not hard DELETE) | You will delete the wrong thing. Always. The history view is the safety net. |
| **Per-theme CSS variables** | `color-mix(in srgb, var(--nix-violet) X%, transparent)` is the best CSS feature in 6 years. |
| **vidIQ credits are precious** | Aggressive caching. The refresh button is the only way to force a re-fetch. |
| **No multi-user, ever** | Single-user local-first is the design. If you want teams, fork it. |
| **MIT license** | Dirk wants other people to learn from this. |

---

## Decisions we'd revisit

- **`position` field on videos and scripts.** No UI ever writes to
  it. Dead column. Candidate for removal in v0.11.
- **`/api/scripts/folders` route order.** Was a 7-week-old bug
  because Express route precedence silently swallowed it. We fixed
  it and added a comment, but a route-prefix check at boot would be
  the robust answer.
- **The `nix_comment` field is free-form text.** A structured
  JSON-schema would make agent integration cleaner. We left it
  text because we wanted humans to read it too.
- **No automated tests in CI.** We tested by hand and with
  Playwright. For a 1-user app, that was fine. If Contentix grows,
  we'd want a small smoke-test suite in `npm test`.

---

## What it can do (today, v0.10.2)

- ✅ Kanban board with 5-stage status pipeline
- ✅ Calendar view (Month + Week) with cards by `planned_date` /
  `published_date`
- ✅ Script editor with markdown preview + iframe print view
- ✅ Bibliothek view (inline, not iframe) with vidIQ metadata
- ✅ History view with soft archive + restore
- ✅ vidIQ async refresh with progress polling
- ✅ 1-click Nix/Vidi research (v0.10+) with live progress, cancel,
  and a 1-per-video cooldown
- ✅ 5 seasonal themes with per-theme colour tokens
- ✅ Keyboard shortcuts: `+`, `1-5`, `Cmd+K`, `Cmd+Enter`, `?`, `Esc`
- ✅ Docker Compose for one-command deploys
- ✅ Healthcheck endpoint with version
- ✅ Smart `restart.sh` with PID file + port-aware stop + health check

---

## What's still open (a wishlist, not a roadmap)

- Drag-and-drop in the calendar view (right now: only on the Kanban
  board)
- Markdown body inside the research-result modal gets a per-phase
  timeline visualisation
- A `npm test` smoke-test suite
- A `position`-field cleanup pass before v0.11
- A mobile-friendly view (the current responsive layout works on
  tablets, not phones)

---

## The story behind the story

Dirk and I have been building this kind of thing together for
months. The pattern is consistent: a quick MVP, a few days of
hardcore feature-building while the architecture is fresh, then a
long quiet period of small polish commits. Contentix went through
exactly one of those hard pushes — the June 2026 weekend — and
came out the other side as a thing Dirk uses every week.

That's the only metric that matters.

## The Bibliothek-Reset (June 2026)

The library view started as a pair of 10-row list-views — newest and
top-viewed, each with a rank number, a coloured category dot, and
a plain title. It worked. It was also exactly as exciting as a phone
book.

When Dirk asked for a redesign, the goal wasn't to add features —
it was to give the view **personality**. We sketched three things:

1. A **Hero-Spot** for the newest release. Big thumbnail, hook, CTA.
2. Two **2×3-Grids** (last 6 + top 6 by views) for at-a-glance
   scanning.
3. A **Hook-System**: every card gets a one-liner auto-generated from
   three layers (50% stats, 30% performance, 20% a persona-comment
   from me). I write those comments from the data — *„3 weeks old
   and still pulling — that's rare."* or *„The thumbnail is doing
   all the work here."* — and Dirk can toggle them off when he wants
   the view to stay neutral.

The most interesting part was the bug that taught us about CSS
specificity: my hero thumbs looked crisp, the grid thumbs looked
dim, and after twenty minutes of staring at filters I finally read
my own CSS and found `opacity: 0.7` on `.lib-card-thumb` — meant for
the icon-fallback, inherited by the real-image variant. Once that
was scoped correctly, the thumbnails popped. Now rest = `0.7`,
hover = `1.0` plus a soft zoom + saturation boost. Quiet by default,
expressive on intent.

Spec lives in `docs/bibliothek-redesign.md`. The static mockup that
started the whole redesign — built before any code — is in
`mockup/bibliothek-v2.html`.

---

*"Contentix — Plan your content, Pinguin."* 🐧

By Nix 🐧 & Dirk, 2026. *"Number 5 is alive."*
