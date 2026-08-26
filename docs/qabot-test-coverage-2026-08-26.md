# Contentix v1 — Test-Coverage-Analyse (qabot, 2026-08-26)

> **Methodik:** Manuelle Analyse der Routes (`index.js`) gegen vorhandene Tests
> (`tests/hero-fallback.spec.js`, `tests/sort-comparator.test.js`, `tests/store.test.js`).
> Backend-Tests existieren quasi nicht; Frontend-Tests nur für reine Logik.

## 1. Coverage-Matrix (Route × Status)

| Route | Method | Status | Test? | Priorität |
|---|---|---|---|---|
| `/api/scripts` | GET | ✅ happy-path only in store.test.js (via fetch mock) | partial | P2 |
| `/api/scripts/folders` | GET | ❌ none | missing | P2 |
| `/api/scripts/:id` | GET | ❌ none | missing | P2 |
| `/api/scripts` | POST | ❌ **SLUG nicht auto-generiert** | missing | **P0** |
| `/api/scripts/:id` | PUT | ❌ none | missing | P1 |
| `/api/scripts/:id` | DELETE | ❌ none | missing | P1 |
| `/api/scripts/import` | POST | ❌ **path-traversal risk** | missing | **P0** |
| `/api/scripts/:id/restore` | POST | ❌ none | missing | P1 |
| `/api/scripts/:id/link` | PATCH | ❌ none | missing | P1 |
| `/api/videos` | GET | ❌ none | missing | P2 |
| `/api/videos/:id` | GET | � none | missing | P2 |
| `/api/videos-with-stats` | GET | ❌ none | missing | P2 |
| `/api/videos` | POST | ❌ **owner default, auto-match side effect** | missing | **P0** |
| `/api/videos/:id` | PUT | ❌ **status === 'published' triggers vidIQ auto-match** | missing | **P0** |
| `/api/videos/:id` | PATCH | ❌ none | missing | P1 |
| `/api/videos/:id` | DELETE | ❌ none | missing | P1 |
| `/api/videos/:id/archive` | POST | ❌ none | missing | P1 |
| `/api/videos/:id/restore` | POST | ❌ none | missing | P1 |
| `/api/vidiq/stats` | GET | ❌ none (cache read) | missing | P2 |
| `/api/vidiq/balance-live` | GET | ❌ **parse-fail recovery critical** | missing | **P0** |
| `/api/vidiq/channel-stats` | GET | ❌ none | missing | P2 |
| `/api/vidiq/watchtime` | GET | � **6h cache logic** | missing | **P1** |
| `/api/vidiq/video/:videoId` | GET | ❌ **24h cache logic** | missing | P1 |
| `/api/vidiq/refresh` | POST | ❌ **6-step background job** | missing | **P0** |
| `/api/vidiq/refresh/status/:jobId` | GET | ❌ none | missing | P2 |
| `/api/vidiq/video-stats/:videoId` | POST | ❌ **direct MCP call, no cache** | missing | P2 |
| `/api/health` | GET | ❌ none | missing | **P1 (cheap!)** |
| `/api/history` | GET | ❌ none | missing | P2 |
| `/api/research/:videoId` | POST | ❌ **subprocess spawn** | missing | **P0** |
| `/api/research/:jobId` | GET | ❌ none | missing | P1 |
| `/api/research/:jobId` | DELETE | ❌ none | missing | P1 |
| `/api/research` | GET | ❌ **list with status filter** | missing | P2 |

**Coverage-Schätzung:** ~2.5% direkte Test-Coverage (3 Test-Files decken geschätzt 1 Route
komplett ab via `store.test.js` Mock-Setup).

## 2. Priorisierte Test-Vorschläge

### P0 — Sofort (~6-8h für die wichtigsten)

1. **`/api/scripts` POST mit fehlendem slug** (10 Min)
   - Sollte laut AGENTS.md 500 ergeben. Test: POST ohne slug → erwarte 500.
   - Bonus: Test mit korrektem slug → erwarte 200 + DB-Insert.

2. **`/api/scripts/import` path-traversal** (30 Min)
   - Test: `filePath: '/etc/passwd'` → erwarte 400 oder Fehler, NICHT Crash.
   - Test: `filePath: '../../../etc/passwd'` → erwarte Schutz.
   - Aktuell: `const fullPath = filePath.startsWith('/') ? filePath : '/home/dirk/yt-research/' + filePath;`
     — absolut prefix wird einfach akzeptiert! **Echte Sicherheitslücke.**

3. **`/api/vidiq/refresh` Background-Job** (2h)
   - Test: POST → erwarte jobId + Status "running"
   - Test: Nach Job-Completion: status "done", progress = total, result = cache
   - Test: Wenn MCP-Call failt: status "error", error.message gesetzt
   - Test: Watchtime-Failure ist non-fatal (Refresh läuft weiter)

4. **`/api/vidiq/balance-live` parse-fail-Recovery** (1h)
   - Mock MCP antwortet mit ungültigem JSON
   - Test: erwarte 502, **NICHT** cache-clobber (verify: `vidiq_cache.balance` bleibt intakt)

5. **`/api/research/:videoId` Subprocess-Spawn** (2-3h)
   - Test mit mock-OpenClaw-Gateway: erwarte jobId + Status "pending"
   - Test: Subprocess crash → Status "failed", error.message gesetzt
   - Test: 1-per-video-Limit — zweiter POST während laufendem Job → 409

### P1 — Diese Woche (~8h)

6. `/api/health` smoke test (5 Min, billig!)
7. `/api/vidiq/watchtime` Cache-Hit/Miss-Logik (1h)
8. `/api/vidiq/video/:videoId` 24h-Cache (45 Min)
9. `/api/videos` PUT auto-match-Trigger (1h) — side effect bei `status='published'`
10. Alle archive/restore Routes (1h)
11. `/api/research/:jobId` Status-Polling (1h)
12. `/api/research/:jobId` DELETE = Cancel (30 Min)

### P2 — Nice to have (~6h)

13. Pure-Funktion-Tests: `slugify`, `parseVidiqResponse` (Edge-Cases der JSON-Decode-Logik)
14. `/api/scripts/folders` distinct-Query
15. `/api/videos-with-stats` cache-fallback-Logik
16. `/api/history` soft-archive-Query
17. List-Routes mit Status-Filter

## 3. Test-Patterns (aus `tests/store.test.js`)

Gut:
- **node --test** statt Mocha → keine Extra-Deps, sub-100ms pro Test
- **Mocking:** `global.fetch = vi.fn()` Pattern oder eigenes `function mockFetch(...responses)`
- **Async/await** konsequent
- **Subscriptions testen:** `store.subscribe(...)` + `store.actions.X()` → assert state shape

Für Backend-Tests brauchen wir:
- **Test-Fixture:** SQLite in-memory oder temp-DB-File pro Test
- **Express-App als Function:** `const app = require('../index.js')` — aber aktuell startet
  `index.js` den Server sofort. **Refactoring nötig:** `module.exports = app` aus
  separater `lib/app.js` (siehe archbot F4).
- **HTTP-Testing:** `supertest` (`npm install --save-dev supertest`) oder direkt mit
  Node's `fetch()` gegen einen lokalen Test-Server.

## 4. Edge-Case-Inventar

- **DB-Migrationen** (`initDB()` ab Zeile 50 in `index.js`):
  - Frische DB (kein File) → alle 6 Tabellen anlegen
  - Bestehende DB ohne `owner` Column → ALTER + Backfill
  - Bestehende `vidiq_refresh_jobs` ohne `started_at` Default → UPDATE mit COALESCE
  - **Kein einziger Test dafür!**

- **MCP-Timeout** (`execSync` mit `timeout: 15000`):
  - Test: Mock MCP der 16s wartet → erwarte TimeoutError + sauberes Error-Response
  - Aktuell: `console.error` + `null` return → Caller muss das handlen

- **Subprocess-Crash** (Vidi-Research, vermutlich `execSync`):
  - Test: OpenClaw-Agent crash bei Spawn → erwarte `research_jobs.status = 'failed'`
  - Test: Subprocess läuft endlos → Timeout greift (falls implementiert)

- **Concurrent Save** (`saveDB()` mit `_saveInFlight`):
  - Test: 10 parallele `saveDB()` Calls → erwarte coalesced write
  - Test: Crash mid-write → erwarte `.bak` von vorherigem erfolgreichem Save

- **Tag-Parsing** (`tags: s.tags ? JSON.parse(s.tags) : []`):
  - Test: DB hat `tags = 'invalid'` → erwarte 500 (kein catch im GET!)
  - Test: DB hat `tags = NULL` → erwarte []

## 5. Quick-Wins (je 5-30 Min)

1. **`/api/health` smoke test** (5 Min)
   ```js
   // tests/health.test.js
   const test = require('node:test');
   const assert = require('node:assert');
   // Assuming app is exported: const app = require('../index.js');
   // const server = app.listen(0);
   const res = await fetch(`http://localhost:${server.address().port}/api/health`);
   assert.strictEqual(res.status, 200);
   const body = await res.json();
   assert.match(body.version, /^\d+\.\d+\.\d+$/);
   ```

2. **Slugify-Unit-Test** (10 Min)
   ```js
   const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
   assert.strictEqual(slugify('Hello World!'), 'hello-world');
   assert.strictEqual(slugify('  --Test--  '), 'test');
   ```

3. **DB-Migration-Test** (30 Min)
   - Setup: leere DB-File, rufe `initDB()` auf
   - Assert: Alle 6 Tabellen existieren mit korrekten Spalten
   - Setup: DB mit fehlendem `owner` Column, rufe `initDB()` auf
   - Assert: `owner` jetzt da, Default 'dirk'

4. **`store.js` Rollback-Test** (20 Min)
   - Mock fetch mit `Promise.reject(new Error('500'))`
   - `await store.actions.createScript({ title: 'X' })` → erwarte Throw
   - `store.select(s => s.scripts)` → erwarte leeres Array (rollback worked)

5. **JSON-Parse-Error-Test** (15 Min)
   - POST `/api/scripts` mit `Content-Type: application/json`, Body: `{ broken json`
   - Erwarte: 400 mit `{ error: 'Invalid JSON body', detail: ... }`
   - (Globaler Error-Handler in `index.js:22-27` testen)

## Aufwandsschätzung

- **P0 + Quick-Wins:** ~8h (1 Wochenende)
- **P1 dazunehmen:** ~16h (2 Wochenenden)
- **P2 + alle Routes:** ~30h (1 Woche Vollzeit)

Für 80%-Coverage der wichtigen Routes: **3-4 Wochenenden.**

---

*By Nix 🐧, 2026-08-26. "Be resourceful, not performative."*
