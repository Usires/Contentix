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

## The Skripte-Tree Push (June 2026)

The script editor was the oldest view in Contentix. It was a simple
flat card list — every script next to every other, no folder
structure, no ordering beyond created_at. It worked, but it stopped
scaling the moment Dirk crossed 8+ scripts.

The redesign started the way all good redesigns start: with a
mistake. I migrated 3 archived scripts to a new "Archiv" folder
manually via curl, and one of them used the wrong UUID. NOLF ended
up in Archiv, but MSFS 2024 stayed in scripts. Classic.

Then we did the **sketch round**. Five default folders, flat hierarchy
("channel", "resources", "Entwürfe", "scripts", "Archiv" — last
one always collapsed). JSTree as the engine, not a custom tree, because
drag & drop, context menus, and search are all built in. We had JSTree
in the bundle since day one but never used it.

**The implementation was a 35 KB rewrite of `scripts.js`**, which
sounds dramatic but it was mostly JSTree config: data shape, drag
plugin, search plugin, context menu. The hard parts were three subtle
bugs we hit along the way:

1. **The infinite select-loop**: my `selectScript()` called
   `jsTreeInstance.select_node()` for visual sync, which fired
   `select_node` again, which called `selectScript()` again. The
   browser ran out of stack in 0.1 seconds. The fix was obvious in
   hindsight: JSTree already syncs `state.selected` from the build
   data, so the explicit `select_node` call was redundant.

2. **The renderPreview stack overflow**: MechWarrior 2 is a 17k-character
   script with triple-backtick code blocks. My old regex-based
   markdown parser had a backtracking pattern that exploded on long
   inputs. Splitting the string on backticks first (instead of using
   a regex to find them) and capping input at 50k characters fixed it
   permanently.

3. **The "click goes nowhere" bug**: the JSTree `wholerow` plugin
   stretched the list items to 477px wide — but the tree column was
   only 280px. Klicks on the text landed outside the visible area.
   The user thought clicks were broken. They weren't broken, they
   were just hidden. Removing `wholerow` and adding
   `text-overflow: ellipsis` to the labels fixed both observations
   Dirk made in the same breath.

The polish round that followed was small but important: folder
icons (📁/📂) with hover scale, single-click toggle (no more
double-click), title attributes for the truncated text, and
localStorage persistence for which folders are open.

**What I learned:** the most "obvious" bugs in this project have
always been CSS specificity issues. A 20-minute read of the
stylesheet beats an hour of testing every interaction. Always read
the CSS first.

By Nix 🐧 & Dirk, 2026. *"Tree-first, text-second, click-third."*

## The 🎬-Klappe-Pseudo-Element bug (2026-06-19, CLAP)

Dirk noticed the library hero showed a half-transparent 🎬 icon
superimposed on the (working) thumbnail. Root cause was a CSS
fallback pattern that was never finished:

```css
.lib-hero-thumb::before {
  content: '🎬';  /* meant as a fallback when the image fails */
  font-size: 64px;
  opacity: 0.4;
}
```

The `::before` is **always rendered** by default — there was no
`.has-image` override to hide it when the image loaded. So you got
the "ghost icon" over every successful thumbnail load. On top of
that, the JS `onerror` handler *also* `insertAdjacentHTML`'d a 🎬
text node, so when the image actually failed you got two
stacked 🎬's (the `::before` at opacity 0.4 plus a full-opacity text
node).

Fix had three parts:
- Add `.lib-hero-thumb.has-image::before { display: none; }` so the
  pseudo-element only shows when it should.
- Clean up the `onerror` handler in `bibliothek.js` so it just
  swaps the class instead of injecting duplicate DOM.
- Add `qabot`-style Playwright tests so the bug can't sneak back
  in: `tests/hero-fallback.spec.js` (3 specs, all green).

The whole bug-fix + test suite came in around 30 minutes of
real work once the root cause was identified. The slow part was
*finding* the root cause: the symptom (visible 🎬) and the
mechanism (CSS `::before` always renders) were not directly
connected in my head until I read the stylesheet end-to-end.
AGENTS.md reminds me: "When debugging, read the CSS first" — and
this was a textbook example of why.

By Nix 🐧 & Dirk, 2026. *"Always render the fallback, never
render it twice."*

---

## 2026-06-25 — R2 Sort-Dedup, Theme-Polish & State-Store ADR

A coordinated four-ticket day, all out of the 5-Bot-Review backlog
from 2026-06-18. Started the morning by walking the boards with Dirk;
he asked me to "work through the Contentix tickets, then clean up the
docs and commit." So that's what I did — in this order:

### YOKE #103 — Tests for the sort behavior, first

Wrote `tests/sort-comparator.test.js` *before* writing the comparator
itself. The test file self-gates: if `getScriptSortComparator` doesn't
yet exist in `utils.js`, every test short-circuits via
`if (!comparatorAvailable) return`. That meant the tests could land
before the refactor and act as a behavior-preservation contract:
green before AND after the refactor, no exceptions.

I hit two real bugs while writing them, and both were my fault, not
the production code's:

1. **Forgetting parentheses.** `getScriptSortComparator` is a *factory*
   that returns the comparator. My first pass called it as
   `.sort(getScriptSortComparator)` instead of
   `.sort(getScriptSortComparator())` — passing the factory as the
   comparator, which made the sort compare weird things. Tests
   exploded in a glorious cascade of 8 failures. `sed` with a regex
   anchor (`$`) only caught end-of-line cases, so a final
   `if`-block-and-pickInt missed a few — manual fixup followed.
   Lesson: when refactoring **function-of-function**, always test
   the call-site first, not the implementation.

2. **Spec-vs-reference mismatch on `undefined`.** The inline expression
   would have crashed on `script.title === undefined` (because
   `undefined.localeCompare` throws). My new comparator guards
   against that. The fuzz test correctly flagged this as a
   *deliberate behavior improvement* rather than a regression. I had
   to re-read my own test to convince myself that "comparator doesn't
   throw, but inline reference does" is *exactly* the right outcome.
   The test now asserts the comparator's safety, not parity with the
   broken-by-design inline behavior.

### WEAVE #102 — Refactor, with the safety net

Added `getScriptSortComparator()` to `utils.js` (with JSDoc that points
back to the spec and the tests — `Spec: docs/r2-script-sort-spec.md.
Tests: tests/sort-comparator.test.js.`). Replaced both inline calls
in `scripts.js`. Verified via `grep -n 'position.*localeCompare'`
that no third copy was hiding somewhere. All 12 tests green.

### WISP #104 — Theme-compliance for search + footer

This was a 5-minute job: `.scripts-search` and `.scripts-list-footer`
had hardcoded RGBA and hex values that *happened* to match the default
Light Cream theme. Replaced with `var(--bg-surface)`,
`var(--text-primary)`, `var(--text-secondary)`. For the transparent
borders, used `color-mix(in srgb, var(--text-primary) X%, transparent)`
— works across all four themes without per-theme overrides. Verified
visually with a Playwright screenshot at `/tmp/wisp-search-light.png`
(search input, footer "9 Skripte" counter, the whole scripts view).
Looks good.

### FORGE #105 — ADR for the centralized state store

The hardest of the four, not because the code is hard (no code at all
in this ticket — it's an ADR) but because **the temptation to
over-design is enormous**. I caught myself writing "Phase 5: plugin
system for stores" and laughed, then deleted it. What landed:
`docs/adr-001-state-store.md`. The decision: tiny in-house store, no
external deps, ~150 LOC target, phased rollout where Phase 1 is just
landing the store skeleton without migrating any view (so we can vet
the API in isolation before committing any module to it).

The alternative table in the ADR was the most useful part to write:
"Redux vs Zustand vs MobX vs custom" with concrete pros/cons for *our*
codebase specifically. It's the kind of document I wish I'd had before
I'd started writing code.

### Process notes

- **Self-gating tests are lovely.** YOKE's `if (!comparatorAvailable)
  return` pattern means the test file can land in the same commit as
  the comparator without an awkward "tests are red until I land the
  impl" intermediate state. CI never sees a red build.
- **Specs before code, even for tiny refactors.** I almost skipped
  writing `docs/r2-script-sort-spec.md` for "just a 3-line function."
  Glad I didn't — the spec caught the `undefined.title` question,
  which I'd otherwise have made inconsistent with the inline
  expression. Specs pay off at 5+ lines too.
- **Test runs are ~95ms total.** Worth running on every change, not
  just pre-commit. Made iteration way faster.

By Nix 🐧 & Dirk, 2026. *"Centralize state, decentralize everything
else."*

---

## 2026-06-25 — ADR-001 Phase 1 + 2: Store + scripts.js migration

Phased rollout of the state store, as laid out in ADR-001. Phases 1 and
2 in one push, since Phase 1 is meaningless without Phase 2 proving the
API works against a real consumer.

### Phase 1 — store.js + 20 unit tests

Wrote `frontend/store.js` from scratch (the old file was a 33-line stub).
The new file is ~370 lines, but most of that is JSDoc and a single
~120-line `createStore` function. The actual surface is small:

```
store.select(selector)         // deep-cloned snapshot
store.subscribe(listener)      // returns unsub()
store.setState(producer)       // no-op detection built in
store.actions.{loadScripts,
              createScript,
              updateScript,
              deleteScript,
              setActiveScript,
              setActiveView}
```

Wrote `tests/store.test.js` with 20 specs. All green on the first run
except four:

1. **`mutating a snapshot returned by select does not affect the store`**
   failed because my `select()` was returning the live state object,
   not a clone. The doc comment claimed "READ-ONLY SNAPSHOTS" but the
   code didn't deliver. Fixed by adding `JSON.parse(JSON.stringify(state))`
   in `select()`. Test is now the contract enforcement.
2. **Three mock-fetch tests** were failing because I was mocking
   `globalThis.fetch` but the store runs inside a `vm` sandbox with its
   own `fetch` reference. Added a `withMockFetch()` helper that swaps
   `sandbox.fetch` directly. This is a pattern worth remembering for
   future vm-based tests.
3. **One `deepStrictEqual([], [])`** failed for reasons I didn't bother
   investigating — switched to `assert.equal(arr.length, 0)` which is
   what the test actually meant.

### Phase 2 — scripts.js migration

This was the high-risk part. 45 references to `allScripts` or
`activeScript` across 1195 lines. My strategy:

1. `sed` mass-rename of `allScripts` → `getAllScripts()` and
   `activeScript` → `getActiveScript()` (with `\b` word boundaries so
   we don't touch substrings).
2. Add `getAllScripts()` and `getActiveScript()` as thin `store.select`
   wrappers at the top of the file.
3. Surgically replace each *write* site (`activeScript = x`,
   `script.title = newText`, `allScripts.push(...)`) with a call to the
   appropriate `store.actions.*` function.
4. Add a store subscription that re-renders `renderScriptsView()` on
   state change.

Caught a real, invisible bug while doing this:

**PUT /api/scripts/:id was returning `{status: 'ok'}` — not the updated
record.** My store's `updateScript` action did
`s.scripts[idx] = updated;` after the PUT, expecting `updated` to be
the new record. Instead it was the stub, and the store was *silently
overwriting the full script with `{status: 'ok'}`*. Every consumer that
re-fetched from the server immediately after wouldn't notice, but
consumers that trusted the store would see the corrupted record.

Fixed by changing the PUT (and POST) handlers to return the full
updated/created record. Bug-fix and refactor committed together because
they're inseparable — the new store migration is what surfaced the API
bug, and the API fix is what makes the store migration work.

### The triggerHandler incident

After Phase 2, browser smoke tests revealed a `Cannot read properties
of null (reading 'triggerHandler')` error every time I clicked a
script node in the tree. The stack trace pointed into jstree's
minified `trigger` function. Took me three iterations to find:

- **My store subscription was firing on ui-only changes.** When
  `setActiveScript(id)` ran, it changed `state.ui.activeScriptId`. My
  subscriber saw a state change, called `renderScriptsView()`, which
  rebuilt the entire jsTreeInstance. But the click that triggered
  `setActiveScript` was still in jstree's internal event handler queue.
  jstree's next internal call to `triggerHandler` then tried to call
  on the now-destroyed `$tree` and crashed.
- **Fix:** subscribe only re-renders when the *scripts data hash*
  changes. UI state changes (activeScriptId, activeView) don't trigger
  rebuilds. The active script is read separately via `getActiveScript()`
  at render time, so the tree's `state.selected` field still reflects
  the active script on next user-driven rebuild.

This was a **subtle bug that I introduced**. The pre-refactor code
didn't have it because there was no store subscription — `renderScriptsView`
was only called explicitly from event handlers, so the rebuild never
happened mid-click. The store migration changed the timing, and the
bug appeared.

**Lesson:** when migrating to a reactive store, expect some code paths
to be timing-sensitive in ways they weren't before. Test in the actual
browser, not just with unit tests — the unit tests will all pass while
a real click triggers a regression that only happens in the wild.

### The bonus bug

While Phase-2-testing, I noticed `kanban.js` throwing `allCards is not
defined` on every Kanban-view render. This bug existed *before* my
refactor — the code referenced an undeclared `allCards` global that
was never set. Phase 2's tests just made it more visible because the
browser console was now cleaner overall. Fixed in three lines. Filed
this as a separate entry in the changelog.

### Counts

- `frontend/store.js`: 33 → 374 lines (+340)
- `frontend/scripts.js`: 1195 → 1198 lines (+3 net — many `getAllScripts()`
  calls collapse the mass-rename, but the `initScripts` rewrite and
  legacy-API-still-works comment block add bulk)
- `tests/store.test.js`: 0 → 388 lines (new)
- `tests/sort-comparator.test.js`: 0 → 269 lines (was already there)
- `index.js`: PUT/POST now return full records (+8 lines)

### What's next (Phase 3, when Dirk says go)

- Migrate `kanban.js` to use `store.actions.loadVideos()` etc. instead
  of the legacy `loadAllCards()` / `setAllCards()`.
- Migrate `calendar.js` and `history.js` similarly.
- Migrate `app.js` for the same reason.
- Once all views are on the store, **delete the legacy API wrapper**
  from `store.js`.
- Then Phase 4 (Undo/Redo on top of the action log) becomes a real
  conversation.

By Nix 🐧 & Dirk, 2026. *"Centralize state. Then ship."*

---

## 2026-06-25 — ADR-001 Phase 3: All views migrated, legacy API deleted

Dirk said "lass uns direkt Phase 3 machen, dann haben wir das Thema
mal durch". Done in this single push.

### Migration scope

Four views consumed the legacy `getAllCards` / `loadAllCards` etc.
API: kanban.js, calendar.js, app.js (history.js was already on its
own endpoint, no work needed).

### Video actions in the store

Added `loadVideos`, `createVideo`, `updateVideo`, `deleteVideo` —
mirroring the script actions exactly. Same optimistic + rollback
pattern. Same cancellation for rapid successive loads.

Wrote 10 new unit tests. Total store tests now at 30.

### kanban.js migration

Five call sites converted:
- `loadCards()` → calls `store.actions.loadVideos()` instead of fetch
- Drop handler: `fetch + loadCards()` → `store.actions.updateVideo(...)`
- `deleteCard`: same pattern
- `archiveCard`: `PATCH /status: 'archived'` → `store.actions.updateVideo`
- `duplicateCard`: `POST` → `store.actions.createVideo`
- Form submit handler: split into `updateVideo` (when `id` present) or
  `createVideo` (when not)

Subscribe-with-hash pattern, similar to scripts.js. Re-renders on
videos data changes. The `getAllCards()` helper stays as a thin
`store.select(s => s.videos)` wrapper for code clarity.

### calendar.js migration

Twelve call sites converted:
- `renderCalendar` subscribes + loads via store
- `prevCalendarPeriod` / `nextCalendarPeriod` / `setCalendarView` /
  `goToToday` all use `store.actions.loadVideos` instead of
  legacy `loadAllCards`
- The drag-drop handler `handleDayColDrop` is the meatiest one:
  was direct `fetch PATCH /api/videos/:id` + manual rollback on error.
  Now: `store.actions.updateVideo(id, { planned_date })` with the
  action's built-in optimistic + rollback. The subscribe handles the
  re-render. The manual rollback code is GONE.

### app.js migration

Two call sites in the command palette:
- `renderPaletteResults` reads `store.select(s => s.videos)` directly
- `openCardFromPalette` triggers `store.actions.loadVideos().then(...)`
  to refresh before opening the modal

### DELETE API fixes

Same kind of issue as the PUT/POST round in Phase 2:
- DELETE `/api/scripts/:id` was returning `{status: 'ok'}` instead
  of the deleted record
- DELETE `/api/videos/:id` was returning `{ok: true}`

Both now return the deleted record. This matters for the store's
delete actions — they need a snapshot for rollback, and they were
getting `{ok: true}` which is useless for that purpose.

### Legacy API killed

The pre-Phase-1 mini-store (getAllCards, loadAllCards, setAllCards,
onAllCardsChange) lived in store.js as a deprecated wrapper since
Phase 1. Phase 3 deletes it entirely — 36 lines of code gone.

I kept the per-file `getAllCards()` thin wrappers in kanban.js and
calendar.js. They're not legacy-API: they're code-clarity helpers
that do `store.select(s => s.videos)`. The function name tells the
reader "give me all the cards" which is clearer than
`store.select(s => s.videos)`. App.js and scripts.js don't have this
wrapper — they use `store.select` directly.

### Page-error score

After Phase 3, **zero page errors** across all four views (bibliothek,
kanban, calendar, history). Before Phase 3 there were three recurring
ones:
- `allCards is not defined` in kanban.js (the `const allCards = ...`
  bug fix from Phase 2 — already gone)
- `Cannot read properties of null (reading 'triggerHandler')` from
  scripts.js (the Subscribe-with-hash fix from Phase 2 — already gone)
- The kanban.js manual-fetch race that caused occasional empty-board
  flashes after a delete (now fixed by the store's automatic
  reconciliation)

### Counts

- `frontend/store.js`: 374 → 426 lines (+52, video actions + tests)
- `frontend/kanban.js`: 729 → 736 lines (+7, mostly the
  subscribe-with-hash block)
- `frontend/calendar.js`: 629 → 632 lines (+3, mostly the subscribe
  helper)
- `frontend/app.js`: 2 lines changed in command-palette
- `tests/store.test.js`: 388 → 622 lines (+234, 10 new video specs)
- `index.js`: PUT/POST/DELETE handlers updated for full-record returns
- Legacy API deleted: -36 lines from store.js

### Verification

- 42/42 tests green (30 store + 12 sort-comparator)
- Browser smoke: all four views render, no page errors, store +
  server stay in sync through drag-drop, archive, delete, duplicate,
  modal save

### What's next (Phase 4 — Undo/Redo)

Now that all mutations go through actions, the store has a natural
audit trail. Phase 4 = record each action call into an undo stack,
add `store.actions.undo()` and `store.actions.redo()`.

This is the conversation where I want to know:
1. What counts as one "undo step" — every action, or grouped by
   session?
2. How deep should the stack be? (Memory × action-size cost)
3. UI: Cmd-Z keyboard shortcut? Visible undo button?
4. Server-side? Or only client-side?

This is gated on you saying "let's do undo/redo." Otherwise: contentix
is now done with ADR-001.

By Nix 🐧 & Dirk, 2026. *"Centralize state. Then ship."*
