# R2 — Spec: `getScriptSortComparator()`

**Ticket:** WEAVE #102 (Contentix Refactor)
**Author:** main-Nix
**Date:** 2026-06-25
**Status:** ✅ Approved (after YOKE tests are green)

---

## Goal

Eliminate the duplicated sort logic that currently appears in two places in
`frontend/scripts.js`:

- **Line ~107** (`buildJsTree()`) — sorts folder scripts for the jsTree render
- **Line ~183** (`select_node.jstree` handler) — sorts folder scripts when
  re-injecting children after a folder is re-opened

Both spots contain the **identical** expression:

```js
.sort((a, b) => (a.position || 0) - (b.position || 0) || a.title.localeCompare(b.title))
```

We want **one place** for this logic so it can be tested, extended, and
reused without fear of drift.

---

## API Design

### Location

`frontend/utils.js` — alongside other shared pure functions (`escapeHtml`,
`truncate`, `formatNumber`). This is the natural home for stateless helpers.

### Signature

```js
/**
 * Returns a comparator function that sorts Contentix scripts by:
 *   1. `position` ascending (missing/null/undefined → 0)
 *   2. `title` ascending using `String.prototype.localeCompare`
 *      (undefined/empty titles sort BEFORE non-empty ones via localeCompare
 *      with the default collator — see "Edge cases" below)
 *
 * @returns {(a: Script, b: Script) => number}
 */
function getScriptSortComparator() { ... }
```

The function returns a **comparator**, not a sorted array. This matches the
existing call sites (`.sort(comparator)`) and keeps the comparator reusable
for future scenarios where the array source is different.

### Behavior

For any two scripts `a` and `b`, the comparator returns:

| Condition                                       | Return |
| ----------------------------------------------- | ------ |
| `a.position` ≠ `b.position` (numeric compare)   | diff   |
| `a.position` === `b.position`, `a.title` ≠ `b.title` | `localeCompare` result |
| Everything equal                                 | `0`    |

---

## Edge cases (must all be tested)

1. **Empty list** — `[].sort(getScriptSortComparator())` → `[]`
2. **Single item** — `[x].sort(getScriptSortComparator())` → `[x]`
3. **Two items, different positions** — `[{p:2}, {p:1}]` → `[{p:1}, {p:2}]`
4. **Two items, same position, different titles** —
   `[{p:0,t:'B'}, {p:0,t:'A'}]` → `[{p:0,t:'A'}, {p:0,t:'B'}]`
5. **Missing `position`** — treated as `0`; two scripts with no position sort by title
6. **`null` position** — same as missing
7. **`title` is `undefined`** — must not throw; `localeCompare` returns `NaN` if
   called on `undefined`, so we **coerce empty string** before comparison
   (matches current behavior, which would also fail loudly on `undefined`)
8. **`title` is empty string** — sorts before any non-empty title (stable, well-defined)
9. **Unicode titles** — `"Äpfel"` vs `"Apfel"` follows locale collator;
   current code relies on `localeCompare` with default locale, so we **do
   the same** (no explicit locale arg → user-default)
10. **Stability** — `Array.prototype.sort` is stable in modern JS engines
    (V8 since Node 12). No additional guarantees needed.

---

## Non-goals

- **No `desc`/`reverse` variant** — YAGNI. Call sites reverse the array if
  they need descending order.
- **No configurable tie-breaker** — if we ever need `updated_at` or `id`
  as a third key, add a second function (`getScriptSortComparatorByRecency`)
  rather than parameterizing this one.
- **No i18n for the locale** — uses default collator to match current
  behavior. If we ever add explicit locales, that is a separate change.

---

## Migration plan

1. **Add `getScriptSortComparator()` to `frontend/utils.js`** with JSDoc
   above.
2. **Replace both inline sort calls** in `scripts.js` with
   `.sort(getScriptSortComparator())`.
3. **Run `tests/sort-comparator.test.js`** — must be green before AND after
   the migration (behavior preservation).
4. **Update `CHANGELOG.md`** under `## [Unreleased]` → `### Refactored`.
5. **No new public API** — this is an internal helper, no AGENTS.md change
   required.

---

## Test file location

`tests/sort-comparator.test.js` — Node native test runner
(`node --test`). No Playwright, no browser. Pure function, fast feedback.

The test loads `frontend/utils.js` via `require()` and pulls out
`getScriptSortComparator()` through the global function (same pattern
`utils.js` already uses — top-level function declarations, no module
wrapping). If we ever switch to ESM, this test gets a single-line import.

---

## Acceptance criteria

- [ ] `getScriptSortComparator()` exists in `frontend/utils.js` with JSDoc
- [ ] Both inline sort calls in `scripts.js` are replaced
- [ ] All 10 edge-case tests pass
- [ ] No other call sites in the codebase use the inline expression
      (verify via `grep -n 'position.*localeCompare' frontend/`)
- [ ] CHANGELOG.md updated
- [ ] No new bugs introduced (manual smoke test: load bibliothek, open/close
      folders, confirm scripts render in the same order as before)