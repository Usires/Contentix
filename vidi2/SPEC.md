# Vidi 2.0 — Local AI Content-Buddy für Contentix

**Status:** Draft Spec (Phase C — vor Code-Implementation)
**Autor:** Nix (mit Dirk)
**Datum:** 2026-09-17

---

## 1. Vision

Vidi ist heute ein **Recherche-Agent** der per User-Click einzelne Themen-Reports erstellt. Vidi 2.0 ist ein **lokaler Service-Layer** der Contentix um **kontinuierliche Themen-Discovery** und **Script-Drafting** erweitert — ohne dass Contentix davon abhängig ist.

**Core-Prinzip:** Contentix funktioniert ohne Vidi. Vidi ist ein Add-on. Beide können unabhängig deployed werden.

---

## 2. Was Vidi 2.0 vom alten Vidi unterscheidet

| Aspekt | Vidi 1.0 (heute) | Vidi 2.0 (neu) |
|--------|------------------|----------------|
| **Trigger** | User-Click pro Card (manuell) | Cron-Job + User-Command (auto + manuell) |
| **Output** | Recherche-Report pro Card | Themen-Vorschläge in Inbox + Script-Skelette |
| **Quelle** | YouTube-MCP (6 Tools) | YouTube-MCP + LILAC-Archive + Contentix-History + Web-Search |
| **State** | Stateless | Persistent (was wurde behandelt, was ist Trend) |
| **KI-Stack** | M3-Cloud only | qwen3.5 (lokal, bulk) + gemma4:12b (lokal, reasoning) + M3 (cloud, fallback) |
| **Integration** | Subagent-Spawn (`openclaw agent --agent youtubebot`) | Standalone-Service mit HTTP-API |

---

## 3. Architektur

### 3.1 Schichten-Überblick

```
┌─────────────────────────────────────────────────────────────┐
│  Contentix (immer funktional, kein Vidi-Dependency)         │
│  • Kanban, Bibliothek, Kalender, History                    │
│  • YouTube-MCP (Phase 2)                                    │
│  • /api/vidi/* Routes (Phase 1) — graceful wenn Vidi down  │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP (Vidi detection per /api/vidi/status)
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Vidi 2.0 Service (separates Add-on)                        │
│  • Läuft als eigener Prozess (z.B. localhost:8191)          │
│  • Hat eigene DB (vidi.db) für State                        │
│  • Cron-triggered Discovery-Runs                            │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP Calls (Contentix-API)
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Lokale KI-Stack                                             │
│  • Ollama (qwen3.5, gemma4:12b)                             │
│  • M3-Cloud (nur finale Synthese, mit User-Freigabe)        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Drei Modi

**Modus 1 — Reactive Research** (Vidi 1.0, bleibt)
- User triggert per `🔭 Vidi`-Button auf Kanban-Card
- Input: einzelnes Video + Brief
- Output: Recherche-Report
- Implementation: bleibt wie heute (`/api/research/*` + OpenClaw-Subagent-Spawn)

**Modus 2 — Proactive Discovery** (Vidi 2.0, neu)
- Trigger: Cron-Job (z.B. täglich 09:00 nach LILAC-Run)
- Input: LILAC-Score (24h) + YouTube-Trend-Search (7d, DE, Linux-Gaming) + Contentix-History (was du zuletzt gemacht hast)
- Output: 3-5 Themen-Vorschläge als Cards in neuer Lane `💡 Vidi-Inbox`
- Implementation: Standalone-Script `discovery.py`

**Modus 3 — Script-Drafting** (Vidi 2.0, später)
- Trigger: User-Command `/vidi draft <topic>`
- Input: Topic + YouTube-Recherche + LILAC-Archiv + Contentix-History
- Output: Script-Skelett (Hook, Structure, Research-Cites, Outline)
- Implementation: `drafter.py` — separate Iteration nach Modus 2

---

## 4. Datenmodell

### 4.1 Contentix-DB (Erweiterungen)

**Neue Tabelle `vidi_suggestions`:**
```sql
CREATE TABLE vidi_suggestions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hook_line TEXT,                  -- 1-Sentence Pitch
  why_now TEXT,                    -- Warum jetzt relevant (Trend-Begründung)
  research_cites TEXT,             -- JSON: [{url, title, snippet}]
  script_skeleton TEXT,            -- 3-bullet Outline
  confidence_score REAL,           -- 0.0-1.0
  source TEXT,                     -- "lilac+yt_search", "yt_search", "lilac_only"
  status TEXT DEFAULT 'inbox',     -- inbox / approved / rejected / archived
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT,
  video_id TEXT,                   -- wenn approved: referenziert erzeugte videos.id
  metadata TEXT                    -- JSON für Erweiterungen
);
```

**Neue Tabelle `vidi_runs`:**
```sql
CREATE TABLE vidi_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT DEFAULT 'running',   -- running / done / failed
  mode TEXT,                       -- discovery / draft
  items_found INTEGER DEFAULT 0,
  items_pushed INTEGER DEFAULT 0,
  error TEXT,
  duration_ms INTEGER,
  metadata TEXT                    -- JSON: ollama_models_used, input_sources
);
```

### 4.2 Vidi-DB (eigene, `vidi.db`)

```sql
-- Knowledge-Cache: was wurde zu welchem Thema schon mal gefunden?
CREATE TABLE topic_history (
  topic TEXT PRIMARY KEY,
  first_seen TEXT,
  last_seen TEXT,
  seen_count INTEGER DEFAULT 1,
  avg_score REAL,
  last_suggestion_id TEXT          -- referenziert Contentix vidi_suggestions.id
);

-- Trend-Memory: rolling-window Velocity-Score pro Topic
CREATE TABLE topic_trends (
  topic TEXT,
  window TEXT,                     -- '24h', '7d', '30d'
  velocity REAL,                   -- mentions per day
  saturation REAL,                 -- 0-1, wie viel von dir behandelt
  last_updated TEXT,
  PRIMARY KEY (topic, window)
);

-- Ollama-Config + Run-Stats
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
```

---

## 5. API-Spec (Contentix-Side)

### 5.1 `/api/vidi/status` (Phase 1)

```
GET /api/vidi/status
```

Response:
```json
{
  "installed": true|false,
  "version": "2.0.0",
  "url": "http://localhost:8191",
  "lastRun": "2026-09-17T09:00:00Z",
  "nextRun": "2026-09-18T09:00:00Z",
  "queueDepth": 0,
  "modelsAvailable": ["qwen3.5", "gemma4:12b"]
}
```

Wenn Vidi nicht antwortet → `installed: false`, kein 500-Fehler.

### 5.2 `/api/vidi/inbox` (Phase 1)

```
GET /api/vidi/inbox?status=inbox&limit=20
POST /api/vidi/inbox/:id/approve  { userId: 'dirk' }
POST /api/vidi/inbox/:id/reject   { userId: 'dirk', reason: '...' }
```

`approve` erstellt automatisch einen `videos`-Eintrag mit `status='research'` (manueller Trigger für User-Recherche).

### 5.3 `/api/vidi/settings` (Phase 1)

```
GET /api/vidi/settings
POST /api/vidi/settings
```

Body: `{ollamaUrl, enabled, cronSchedule, modelsPreference}`

### 5.4 `/api/vidi/runs` (Phase 1, observability)

```
GET /api/vidi/runs?limit=10
```

Response: Liste der letzten Runs mit Dauer, Items-Found, Errors.

---

## 6. Vidi 2.0 Service-Spec

### 6.1 Endpoints

```
POST /run/discovery    -- trigger manuell oder cron
GET  /status           -- service health (für Contentix detection)
GET  /runs             -- list runs (für Debug)
POST /settings         -- update config
```

### 6.2 Discovery-Pipeline (Modus 2)

```
1. Pull Data (parallel)
   • LILAC: GET http://asbach-games:8182/api/lilac/recent?hours=24
   • YouTube MCP: search_videos("Linux gaming DE", order=date, maxResults=20)
   • Contentix: GET /api/videos?since=30d → Set der behandelten Topics

2. Local Classification (qwen3.5, ~3s/Item)
   • Pro Item: Topic-Tag, Saturation-Check, Sweet-Spot-Match
   • Filter: nur Items mit Confidence > 0.6

3. Trend-Detection (gemma4:12b, ~10s)
   • Velocity-Score (mentions per day im 7d-Window)
   • Why-Now-Begründung (was macht es gerade relevant?)
   • Cluster-Bildung (ähnliche Topics zusammenfassen)

4. Synthesis (qwen3.5, ~5s)
   • Pro Cluster: Title + Hook-Line + Script-Skeleton (3 bullets)
   • Confidence-Score

5. Push to Contentix
   • POST /api/vidi/inbox (oder direkt INSERT in vidi_suggestions)
   • POST /api/vidi/runs (run-summary loggen)

Gesamt-Pipeline: 30-90s pro Discovery-Run
```

### 6.3 Cron-Setup

```yaml
# systemd-user timer
[Unit]
Description=Vidi 2.0 Discovery Run

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /home/dirk/contentix/vidi2/service.py run-discovery
```

Oder via OpenClaw-Cron wenn vorhanden.

### 6.4 File-Layout (Vidi-Service)

```
vidi2/
├── SPEC.md                          ← diese Datei
├── README.md                        ← Install-Guide
├── docker-compose.vidi.yml          ← opt-in compose
├── .env.vidi.example                ← Vidi-Config-Vorlage
├── vidi.service                     ← systemd-User-Service
├── vidi.timer                       ← systemd-User-Timer
├── src/
│   ├── service.py                   ← FastAPI/Express-Server
│   ├── discovery.py                 ← Modus 2 Pipeline
│   ├── drafter.py                   ← Modus 3 (später)
│   ├── knowledge/
│   │   ├── contentix_history.py     ← was du zu gemacht hast
│   │   ├── lilac_archive.py         ← LILAC-Items
│   │   ├── trends.py                ← Trend-Scoring
│   │   └── sweet_spots.py           ← was bei dir performt
│   ├── models/
│   │   ├── ollama_client.py         ← Ollama-Wrapper
│   │   ├── classifier.py            ← qwen3.5 bulk-classify
│   │   ├── reasoner.py              ← gemma4:12b multi-step
│   │   └── synthesis.py             ← final output
│   ├── contentix_bridge.py          ← POST zu Contentix-API
│   └── db.py                        ← vidi.db management
└── tests/
    └── test_discovery.py            ← Smoke-Tests
```

---

## 7. Detection-Pattern (Contentix)

Contentix erkennt Vidi via Health-Check. Implementation in `frontend/app.js`:

```js
async function vidiStatus() {
  try {
    const res = await fetch('http://localhost:8191/status', { timeout: 2000 });
    if (res.ok) return await res.json();
  } catch (e) { /* Vidi not installed */ }
  return { installed: false };
}

// Auf App-Load:
const vidi = await vidiStatus();

// Conditional UI:
{vidi.installed && <VidiInboxLane />}
{vidi.installed && <VidiSettingsCard />}
```

**Wichtig:** Wenn Vidi nicht antwortet, rendert Contentix **ohne Fehler** weiter. Lane ist weg, Settings-Card ist weg, aber alles andere funktioniert.

---

## 8. UI-Spec

### 8.1 Neue Kanban-Lane `💡 Vidi-Inbox`

Position: vor `backlog` (links)

**Card-Inhalt:**
- **Title** (groß, lesbar)
- **Hook-Line** (italic, klein)
- **Confidence-Score** (badge, 0.0-1.0)
- **Source-Badge** (`LILAC+YT`, `LILAC`, `YT`)
- **Why-Now** (collapsed, expandable)
- **Actions:** `→ Approve (Research)` | `✕ Reject` | `↗ Open Script-Skeleton`

### 8.2 Settings-Card `🎬 Vidi-AI-Buddy`

In Contentix-Settings-Page, conditional auf `vidi.installed`:
- Status (Last Run, Next Run)
- Ollama-URL (editierbar)
- Models Preference (Multi-Select: qwen3.5, gemma4:12b, M3-Cloud)
- Cron-Schedule (z.B. `0 9 * * *` für täglich 09:00)
- Enable/Disable Toggle
- Manual Trigger: `🔄 Run Now`

### 8.3 Dashboard-Widget (optional, Phase 2)

Auf Contentix-Dashboard:
- Letzte 3 Discovery-Runs (mit Items-Count)
- Trend-Topics (was performt gerade in DE/Linux-Gaming?)
- Approve/Reject-Stats (was hat Dirk akzeptiert, was nicht)

---

## 9. Privacy-Layer

**Was lokal bleibt (Default):**
- Roh-Daten (YouTube-Stats, RSS-Feeds, LILAC-Items)
- Bulk-Klassifikation (qwen3.5)
- Trend-Analyse (gemma4:12b)
- Themen-Vorschläge (Title, Hook, Skeleton)

**Was nur mit User-Freigabe in die Cloud geht:**
- Finale Synthese (M3-Cloud)
- Kreative Hooks wenn vom User explizit angefordert
- Script-Drafts (Modus 3, später)

**Privacy-Setting in vidi/settings:**
```json
{
  "cloudFallbackEnabled": false,
  "cloudFallbackTriggers": ["final_synthesis", "creative_hooks"]
}
```

---

## 10. Implementation-Plan

| Phase | Was | Effort | Status |
|-------|-----|--------|--------|
| **0** | Spec (dieses Dokument) | done | ✅ |
| **1.1** | Contentix-Backend: `/api/vidi/*` Routes + DB-Migrations | 4-6h | pending |
| **1.2** | Contentix-Frontend: Conditional UI + Vidi-Inbox-Lane | 4-6h | pending |
| **2** | Vidi-Service-Skeleton: FastAPI/Express + Health + Discovery-Stub | 4-6h | pending |
| **3** | Vidi Discovery-Pipeline: LILAC + YT-MCP + Bulk-Classify + Push | 1-2 Tage | pending |
| **4** | Vidi Settings-Card UI + Cron-Setup | 4-6h | pending |
| **5** | Repo-Struktur-Trennung: vidi2/ als Add-on, docker-compose.vidi.yml | 1-2 Tage | pending |
| **6** | README + INSTALL-Guide für Open-Source | 1 Tag | pending |
| **7** | Modus 3: Script-Drafting | 2-3 Tage | pending |

---

## 11. Offene Fragen (beantwortet 2026-09-17)

1. **Cloud-Fallback:** ✅ **M3-Fallback aktiviert.** Privacy-Layer lässt Bulk lokal, finale Synthese fällt auf M3-Cloud zurück wenn User das in Settings erlaubt.

2. **LILAC-Integration:** ✅ **Contentix-Proxy.** Vidi spricht nicht direkt mit LILAC sondern über Contentix-API. Vorteil: andere Systeme (z.B. Newsletter-Tools) können später auch angedockt werden.

3. **Trend-Window:** ✅ **Cron täglich** (Default 09:00 nach LILAC-Run). User kann in Settings Override setzen (z.B. `0 9,18 * * *` für 2x täglich).

4. **Confidence-Threshold:** ✅ **3-5 Vorschläge** pro Run. Wenn weniger als 3 Items den Threshold (0.6) erreichen, wird die Run als "thin" markiert und nicht gepushed (nur geloggt).

5. **Multi-Channel:** ✅ **Per-Channel-Tag** (Variante B). `vidi_suggestions.target_channel_id` ist nullable (NULL = "any channel"), Inbox-Card zeigt kleinen Channel-Badge, Settings hat Default-Channel-Dropdown. Simpel wenn 1 Kanal, skaliert sauber wenn mehrere dazukommen.

6. **Notification:** ✅ **Toast bei neuen Vorschlägen.** Wenn Discovery-Run läuft und Items findet, feuert Contentix einen Toast "💡 Vidi hat N neue Ideen — [→ Inbox öffnen]". Kein Push, nur in-app.

---

**Stand:** 2026-09-17, Nix + Dirk, nach Spec-Approval
**Nächster Schritt:** Phase 1.1 — Contentix-Backend Routes + DB-Migrations

---

## 12. Phase-3-Status (TODOs für nächste Session)

**Phase 3 ist konzeptionell komplett** (alle Module, Prompts, Service-Integration).
Aber **Datenquellen sind noch nicht korrekt verdrahtet**, daher gibt der erste
echte Discovery-Run `itemsFound: 0` zurück.

### Bug 1 — LILAC-Archive-Schema-Mismatch
- **Datei:** `apricot-YYYY-MM-DD.meta.json`
- **Erwartet:** Item-Liste mit `title`, `score`, `url` (vom LILAC-Scorer).
- **Tatsächlich:** Summarize-Schema `{youtube: bool, articles: int, categories: {}}`.
- **Effekt:** `load_recent_items()` gibt 0 zurück.
- **Fix:** Entweder a) meta.json anders parsen (nur `articles`-Zahl nutzen als Indikator) oder
  b) direkt `lilac.py` triggern und HTML-Output parsen statt meta.json-Datei zu lesen.

### Bug 2 — YT-MCP-Endpoint-Findung
- **Datei:** `vidi2/src/knowledge/yt_search.py` → `call_mcp_search()`
- **Erwartet:** `localhost:8190/mcp/call` mit Tool-Name + Params.
- **Tatsächlich:**
  - `/mcp/call` → 404
  - `/invoke` → GET 200, POST 404 (Catchall)
  - `/health` → 200 mit `{"server":"contentix-youtube-mcp","version":"0.1.0"}`
- **Effekt:** YT-Trending-Data kommt nicht rein.
- **Fix:** Source-Code vom MCP-Server anschauen (`/home/dirk/contentix/mcp-servers/youtube/`)
  und den echten RPC-Endpoint herausfinden. Achtung: `find`-Prozesse killen sich aktuell
  via OpenClaw OOM-Wrapper — manuell mit `ls` + `cat` arbeiten.

### Bug 3 — Cron-Setup fehlt
- Discovery-Runs müssen täglich 09:00 automatisch laufen.
- Status: nur `DISCOVERY_CRON` Env-Var ist da, aber kein systemd-user-timer und kein
  OpenClaw-Cronjob registriert.
- **Fix:** Entweder systemd-user-timer schreiben (`vidi.timer` + `vidi.service`)
  oder über OpenClaw-Cron registrieren.

### Bug 4 — NixBoard-Card angelegt aber DB read-only
- Wollte Card "Vidi 2.0: Discovery Sources verdrahten" in NixBoard-Backlog anlegen.
- `sqlite3 kanban.db` meldet `attempt to write a readonly database (8)` trotz
  `root:root 666` permissions. Vermutlich WAL-Lock vom laufenden NixBoard-Server.
- **Fix:** morgen manuell über NixBoard-UI oder NixBoard-Server kurz stoppen +
  WAL-File (`kanban.db-wal`) prüfen.

### Was morgen erwartet wird
1. Bug 1 (LILAC) + Bug 2 (YT-MCP) fixen — realistisch 45-90 Min.
2. Ersten echten Discovery-Run triggern und Karten in Contentix-Inbox anschauen.
3. Bei erfolgreichem Run: CHANGELOG für Phase 3 ergänzen.
4. Cron-Setup (systemd-timer) als Wochenaufgabe.
5. Modus 3 (Script-Drafting) als nächste Iteration — separate Spec-Phase.

**Stand:** 2026-09-17 Abend, Dirk uebergibt an morgen, Nix + Dirk
