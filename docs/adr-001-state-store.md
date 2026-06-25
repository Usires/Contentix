# ADR-001: Centralized State Store for Contentix

**Status:** Proposed (2026-06-25)
**Author:** main-Nix (with archbot reasoning via FORGE #105)
**Ticket:** FORGE #105
**Affects:** `frontend/scripts.js`, `frontend/app.js`, `frontend/kanban.js`, `frontend/calendar.js`, `frontend/history.js`, `frontend/store.js`

---

## Context

Contentix's frontend has grown organically across 5+ view modules (`scripts.js`,
`app.js`, `kanban.js`, `calendar.js`, `history.js`) plus a stub `store.js`.
Each module owns its own piece of UI state with top-level `let` declarations:

| File | State | Type |
|---|---|---|
| `scripts.js` | `allScripts`, `activeScript`, `autoSaveTimer`, `isDirty`, `jsTreeInstance` | data + ui + timers |
| `app.js` | `allContent`, `activeFilter`, `vidiqCancelToken`, `_paletteActiveIndex`, `_paletteItems` | data + ui + async tokens |
| `kanban.js` | `activeColumn`, `toastTimer`, `draggedCard`, `draggedFromColumn`, `_confirmCallback`, `_confirmFormHTML` | ui + drag-and-drop |
| `calendar.js` | `currentDate`, `selectedDay`, `_draggedCardId` | data + ui + drag |
| `history.js` | `allHistoryVideos`, `currentHistoryFilter` | data + ui |
| `store.js` | (currently 33 lines, mostly empty stub) | — |

### Problems this causes (observed)

1. **Cross-view state sync is manual.** When a script is updated via the
   editor, every consumer (`scripts.js`, `kanban.js`, `calendar.js`) must
   independently refetch from `/api/scripts` to stay in sync. There is no
   authoritative cache; each module's `allScripts` / `allContent` /
   `allHistoryVideos` may diverge momentarily.
2. **Mutation is invisible.** `let allScripts = [];` followed by in-place
   `allScripts.push(...)` or `arr[i].field = ...` is not visible to anyone
   except the file that declared it. No change events, no audit trail.
3. **No undo/redo story.** The closest we have is the Browser's native
   `<input>` undo stack. "I deleted the wrong card" is unrecoverable without
   a DB rollback.
4. **Race conditions hide.** `vidiqCancelToken` is a good pattern (per-call
   cancel token) but it's the only such pattern in the codebase. Other async
   flows lack cancellation discipline.
5. **Testing is hard.** `allScripts` is set by side-effect inside an event
   handler. To test a kanban card move, you have to set up DOM, mock the API,
   fire the event, *and* assert against the right module's globals.
6. **`store.js` is a stub.** It exists (33 lines, imported nowhere) but does
   nothing. We have the file name reserved and zero commitment to a pattern.

---

## Decision

**Adopt a tiny in-house state store, modeled on a strict subset of the
Redux/Zustand pattern, with no external dependencies.**

Concretely:

- One file `frontend/store.js` becomes the **only** place where shared state
  lives. The 33-line stub is replaced with a ~150-line implementation.
- State is exposed as **read-only snapshots** to consumers, mutated only via
  **action functions** that the store owns.
- Every state change emits a **change event**; views subscribe and re-render.
- The store handles its own data fetching (with cancellation) for entities
  that have a backing REST endpoint (`scripts`, `videos`, `history`).

### Concrete API shape

```js
// Single store instance
const store = createStore({
  scripts: [],
  videos: [],
  history: [],
  ui: {
    activeScriptId: null,
    activeView: 'bibliothek',
    activeFilter: 'all',
    activeColumn: 'ideas'
  },
  meta: {
    loading: { scripts: false, videos: false },
    errors: {}
  }
});

// Subscriptions
const unsub = store.subscribe(state => {
  // re-render my view
});

// Action: pure intent, store handles the side-effect
await store.actions.createScript({ title: 'New', folder: 'drafts' });
// → optimistic update → POST /api/scripts → reconcile on response

// Read: always a snapshot, never a reference to the live array
const scripts = store.select(state => state.scripts);
```

### Why a custom store, not a library?

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Custom mini-store** (this ADR) | Zero deps, ~150 LOC, fits our exact shape, no framework lock-in | We maintain it | ✅ Chosen |
| Redux Toolkit | Mature, devtools, large community | ~12 KB min+gz, new mental model for `createSlice`/`createAsyncThunk`, overkill for ~5 views | ❌ Too heavy |
| Zustand | Minimal API (~1 KB), hook-based | React-only idiom, our vanilla JS doesn't fit cleanly | ❌ Wrong paradigm |
| MobX | Transparent reactivity via Proxies | Runtime overhead, observable semantics differ from our current mental model, ~16 KB | ❌ Wrong paradigm |
| Vanilla event emitter + module-globals | "What we already do" | Solves none of the 6 problems above | ❌ Status quo |

The custom store is **the smallest thing that solves the problems we have**.
It also leaves us a clean migration path: if we ever adopt React or a
similar framework, the store's API is similar enough to Zustand that a
swap is mechanical.

---

## Consequences

### Positive

- **Single source of truth.** `allScripts` lives in one place. No more
  "did `kanban.js` get the update yet?" guessing.
- **Observable.** Every view that depends on data subscribes once; the
  store calls it when relevant state changes.
- **Undo/redo becomes tractable.** Because all mutations go through actions,
  we can record action history. Undo = replay inverse actions. Redo = replay
  forward. ~50 LOC on top of the store.
- **Testable.** Action functions are pure-ish (they can be called with a
  mocked API client and assert against the next state snapshot). No DOM
  needed for state-shape tests.
- **Optimistic updates.** The store applies state changes immediately and
  reconciles when the API responds. Users feel speed; errors roll back.
- **`store.js` stops being a stub.** Clear contract, documented API, used by
  every module.

### Negative

- **One-time migration cost.** Every `let allX = []` needs to be replaced
  with `store.select(state => state.x)`. Estimated 2-3 days for a careful
  port, given 5 view modules.
- **Slight indirection.** New contributors must read `store.js` to find
  state. Mitigation: a one-page diagram in `docs/state-flow.md`.
- **Temptation to over-centralize.** Drag-and-drop transient state
  (`draggedCard`, `_draggedCardId`) does **not** belong in the store —
  it's purely view-local. We'll write a `useLocalState()` helper for those.
- **Risk of premature abstraction.** If only one view touches a piece of
  data, putting it in the store is overkill. Rule: **store = shared,
  local = local.**

### Neutral

- The shape of `state.ui` will likely evolve as we add new views. That's
  fine — the store treats it as opaque.
- The existing `let isDirty = false` etc. in `scripts.js` may stay for now
  (they're genuinely local to the editor view). We migrate only the shared
  data first.

---

## Rollout plan

1. **Phase 1 (this PR's scope, ~1 day):** Land `store.js` skeleton with
   `createStore`, `subscribe`, `select`, `actions` skeleton. Don't migrate
   any view yet. Add unit tests for the store itself
   (`tests/store.test.js`).
2. **Phase 2 (~1-2 days):** Migrate `scripts.js` to use
   `store.select(s => s.scripts)`. View still owns its UI state. Run full
   manual smoke + Playwright suite.
3. **Phase 3 (~1 day):** Migrate `kanban.js`, then `calendar.js`,
   then `history.js`. Each in its own PR.
4. **Phase 4 (~1 day, optional):** Undo/redo on top of the action log.
   Gated on user demand — YAGNI until then.

Phases 2-3 can be deferred. The decision **to centralize** is independent
of **how fast we migrate**. We don't need to migrate everything to start
benefiting — even one view on the store proves the pattern.

---

## Alternatives considered (in detail)

### Stay with module-globals

- **Pro:** Zero work.
- **Con:** Every problem in the "Problems this causes" list stays forever.
- **Verdict:** Rejected. The codebase is at the size where the cost of
  scattered state is already visible (e.g., the manual refetch dance in
  `app.js:152` after a script update).

### Use Redux Toolkit

- **Pro:** Battle-tested, RTK Query handles our REST needs, Redux DevTools
  are amazing.
- **Con:** ~12 KB min+gz; new vocabulary (`createSlice`, `createAsyncThunk`,
  `useSelector`); our vanilla-JS views would need a glue layer because
  we don't use React hooks.
- **Verdict:** Rejected. We'd be paying for features we don't need
  (time-travel debugging, middleware ecosystem) with code we can't easily
  reuse.

### Use a Proxy-based reactive system (MobX-style, hand-rolled)

- **Pro:** Magic — read any property, get notified on change.
- **Con:** Proxies are a footgun for serializability, JSON.stringify breaks,
  devtools don't show what changed. We lose the explicit "this is an action"
  mental model that we want for undo/redo.
- **Verdict:** Rejected. Explicit actions > magic reactivity for a code-base
  that values clarity.

---

## Open questions

1. **Where does caching live?** The store caches by default (it's the source
   of truth). Do we want TTL-based invalidation, or "refetch on every view
   mount"? **Default choice:** refetch on mount, plus an explicit
   `store.actions.invalidate('scripts')` for after-mutation cases.
2. **Optimistic update rollback UX?** If a POST fails after we've already
   shown the new card optimistically, do we (a) silently remove it, (b)
   mark it with a red retry badge, (c) show a toast with retry button?
   **Default choice:** (b) — mark with retry badge; non-destructive, user
   keeps context.
3. **WebSocket / SSE?** Not on the roadmap, but the store's `subscribe`
   pattern is compatible with pushing server events later. Out of scope
   for this ADR.

---

## References

- WEAVE #102 (folder sort dedup) — solved a *symptom* of scattered code.
  This ADR addresses the *root cause*.
- WISP #104 (search/footer theme compliance) — independent of state store.
- Existing `frontend/store.js` (33 lines) — gets replaced.
- 5-Bot-Review 2026-06-18 — multiple bots flagged state-management as a
  recurring theme in their findings.

---

**Reviewers wanted.** Once approved, this ADR becomes the contract for
Phase 1. Phases 2+ are gated on Dirk's "yes, do it."