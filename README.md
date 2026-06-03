# Contentix — Der Kreativ-Kompass

*Für "The Dirk" YouTube-Kanal. gebaut mit Nix 🐧*

---

## Überblick

Contentix ist ein Video-Planungstool für YouTube-Kanäle. Es hilft bei:
- **Ideen verwalten** (Kanban-Board mit 5 Spalten)
- **Kalender** (Month/Week View mit geplanten Videos)
- **Channel Stats** (vidIQ-Integration, "Das Logbuch" Design)
- **Video-Pipeline** (Draft → Planned → Recording → Published)

**Stack:** Node.js + Express + sql.js (Frontend + Backend in einer App, Port 3038)  
**Frontend:** Vanilla JS + CSS (kein Framework), 4 View-Panels  
**vidIQ:** MCP-basierte Integration für Channel-Stats und Video-Metadaten

---

## Quick Start

```bash
cd /home/dirk/contentix
node index.js
# → http://contentix.asbach-games.fritz.box (Port 3038)
```

---

## Architektur

### Verzeichnisstruktur

```
contentix/
├── index.js              ← Backend (Express, API, vidIQ MCP calls)
├── contentix.db         ← SQLite (sql.js), Videos + vidIQ Cache
├── .env                 ← VIDIQ_API_KEY
├── msfs-linux-update.js ← vidIQ MCP Server (nicht Contentix-Feature)
└── frontend/
    ├── index.html        ← HTML-Struktur (Sidebar + .main + View-Panels)
    ├── app.js            ← Hauptrouter, loadStats, Navigation
    ├── kanban.js         ← Kanban-Board (Drag&Drop, Card-CRUD)
    ├── calendar.js       ← Kalender (Month/Week, Card-Placement)
    ├── store.js          ← Zentraler State (Store-Pattern)
    ├── utils.js          ← escapeHtml, formatNumber, truncate
    ├── styles.css        ← Globales CSS
    ├── kanban.css        ← Kanban-Board (5-Spalten Grid)
    └── calendar.css       ← Kalender-Layout
```

### Routing

`app.js` → `setupNav()`:

| Sidebar-Nav | View | Inhalt |
|-------------|------|--------|
| `data-view="ideas"` | `#ideasView` | Kanban-Board (`#kanbanBoard`) |
| `data-view="content"` | `#contentView` | Expeditionen + Channel Stats |
| `data-view="calendar"` | `#calendarView` | Kalender |
| `data-view="settings"` | `#settingsView` | Einstellungen |

`#ideasView` enthält `<div id="kanbanBoard" class="board">` — das `class="board"` ist kritisch für das Grid-Layout.

---

## State Management

### Zentraler Store (`store.js`)

```js
getAllCards()      → gibt alle Karten zurück (lokale Kopie)
setAllCards(cards)→ updated lokale Kopie + notify all listeners
loadAllCards()    → fetch von /api/videos + setAllCards()
```

**Pattern:** pub/sub — alle Listener werden informiert wenn sich `allCards` ändert.  
**Wichtig:** `calendar.js` und `kanban.js` nutzen NUR den Store. Keine eigenen `allCards`.

### Veraltet: `window.allCards`

Früher gab es ein globares `window.allCards`. Das verursachte Race Conditions weil calendar.js und kanban.js verschiedene Referenzen hatten. Jetzt über Store.

---

## Kanban-Board

### Spalten (5)

| ID | Label | Farbe |
|----|-------|-------|
| `ideas` | 💡 Ideen | `--lavender-mid` |
| `research` | 🔬 Recherche | `--celtic-blue` |
| `skript` | ✏️ Skript | `--nix-violet` |
| `recording` | 🎬 Recording | `--warning` |
| `published` | ✅ Publiziert | `--success` |

### CSS Grid

```css
.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(240px, 1fr));
  gap: 16px;
}
```

### Drag & Drop

`kanban.js` → `handleDrop()`:
- Zieht Karte von Spalte A nach B
- PUT `/api/videos/:id` mit neuem `status`
- `await loadCards()` → Store updated → alle Views sync

---

## vidIQ Integration

### Backend (`index.js`)

**Endpoints:**

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/vidiq/refresh` | POST | Ruft vidIQ MCP auf, cached alle Daten |
| `/api/vidiq/channel-stats` | GET | Channel-Stats aus Cache (subs, views, watchtimeHours) |
| `/api/vidiq/video/:videoId` | GET | Einzelnes Video aus vidIQ (cached) |
| `/api/videos` | GET/POST | CRUD für Videos |
| `/api/videos/:id` | PUT/DELETE | Video updaten/löschen |

### vidIQ Datenstruktur

```js
// /api/vidiq/refresh response
{
  stats: {
    currentStats: { subscribers: 395, views: 20765, videos: 17 },
    // NICHT stats.subscribers → das ist undefined!
    // Richtig: stats.currentStats.subscribers
  },
  latestVideo: { title, videoId, thumbnail, publishedAt },
  balance: { remainingCredits: 0 }
}
```

**Häufiger Fehler:** `data.stats.subscribers` → `undefined`.  
**Richtige Pfad:** `data.stats.currentStats.subscribers`.

### Credits-Sparen

- `/api/vidiq/video/:videoId` cached Ergebnisse in `vidiq_video_cache` Tabelle
- Wird nur abgerufen wenn `title` oder `thumbnail_url` leer sind
- vidIQ hat nur 2000 Credits/Monat — jeder Call zählt

---

## "Das Logbuch" — Channel Stats Design

Sidebar-Panel mit warmem, personal Look:

```
┌─────────────────────────────┐
│ Letzte Expedition            │
│ [Thumb] Titel               │
│ Datum · Auf YouTube →       │
├─────────────────────────────┤
│ 🚀 395  👁 20K  ⏱ 12K  📅17│
└─────────────────────────────┘
```

**CSS:** Playfair Display für Headlines, Inter für Body.

---

## Kalender

### Month View

- 7-Spalten CSS Grid (Mo-So)
- Cards werden nach `planned_date` oder `published_date` positioniert
- Farbcodierung nach Status

### Week View

- `weekIndex` (0-4) für Wochen innerhalb eines Monats
- Grid: 7 Spalten × 1 Row
- Navigation: `prevCalendarPeriod()` / `nextCalendarPeriod()`

### Card-Placement

```js
// calendar.js → cardDiff von firstDate der Woche berechnet
const dayDiff = (plannedDate - firstDate) / (1000 * 60 * 60 * 24);
// → korrekte Position im Week-Grid
```

---

## Das Diary-System

### `write-diary.py`

Schreibt Einträge simultaneous in **zwei** Systeme:

1. **Hugo** → `/var/www/thedirk.org/content/nix/diary-YYYY-MM-DD.md`
2. **Qdrant** → `nix-memory` Collection (768d, type=diary)

### Ollama Embeddings

```python
def generate_vector(text):
    payload = {"model": "nomic-embed-text:latest", "prompt": text[:2000]}
    req = urllib.request.Request("http://127.0.0.1:12434/api/embeddings", ...)
    return json.load(resp)["embedding"]  # 768 Dimensionen
```

### Collection: `nix-memory`

| Feld | Beschreibung |
|------|-------------|
| `type` | "diary", "memory", oder "hugo-migration" |
| `title` | Titel des Eintrags |
| `content` | Markdown-Inhalt |
| `date` | YYYY-MM-DD |
| `tags` | ["diary", "nix"] |
| `source` | "hugo-migration" (bei importierten alten Einträgen) |

### Qdrant CLI Commands

```bash
# Alle Punkte in nix-memory
curl http://localhost:6333/collections/nix-memory | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['points_count'])"

# Collection löschen + neu erstellen
curl -X DELETE http://localhost:6333/collections/nix-diary
curl -X PUT http://localhost:6333/collections/nix-diary -H "Content-Type: application/json" -d '{"vectors":{"size":768,"distance":"Cosine"}}'
```

---

## Häufige Probleme

### Kanban-Spalten untereinander statt nebeneinander

**Ursache:** `<div id="kanbanBoard">` hat kein `class="board"`.  
**Fix:** `<div id="kanbanBoard" class="board">`

### Sidebar-Navs zeigen Views in falschem Bereich

**Ursache:** View-Panels waren innerhalb `<aside>` statt in `<main>`.  
**Fix:** Struktur in `index.html` korrigiert — `</aside>` vor allen Views, `<div class="main">` um View-Panels.

### vidIQ Channel-Stats zeigen 0

**Ursache:** Falscher Datenpfad — `data.stats.subscribers` ist `undefined`.  
**Fix:** `data.stats.currentStats.subscribers` in `/api/vidiq/channel-stats` Handler.

### Calendar zeigt "Cannot read properties of undefined (reading 'filter')"

**Ursache:** `renderCalendarGrid(window.allCards)` — `window.allCards` war `undefined` weil Store noch nicht geladen.  
**Fix:** `getAllCards()` aus Store verwenden statt global.

### Doppelte State-Referenzen

**Ursache:** `kanban.js` hatte eigenes `allCards = cards` PLUS `setAllCards(cards)`.  
**Fix:** Nur noch `setAllCards(cards)` — Store notifyed alle Listener.

---

## Cron Jobs

### Heartbeat (alle 2 Stunden)

```bash
# Game Server Check
pgrep -la 7DaysToDie | wc -l    # sollte 1 sein
pgrep -la ucc-bin | wc -l         # sollte 1 sein

# Docker Check
docker ps --format "{{.Names}}: {{.Status}}" | grep -v "^Up"  # keine gestoppten

# Disk Check
df -h /var/srv  # alert wenn >80%
```

### Diary Backup (täglich 09:00 Berlin)

`memory-sync.py` — synct memory/*.md nach Qdrant `nix-memory`.

### Newsletter LILAC (Mo/Mi/Fr 08:00)

`lilac.py` → `/home/dirk/.openclaw/workspace/scripts/lilac.py`

---

## Nützliche Commands

```bash
# Contentix neustarten
cd /home/dirk/contentix && node index.js &

# vidIQ Refresh manuell
curl -X POST http://localhost:3038/api/vidiq/refresh

# Channel Stats check
curl http://localhost:3038/api/vidiq/channel-stats | python3 -m json.tool

# Qdrant Status
curl http://localhost:6333/collections

# Hugo Blog neubauen (für Diary)
cd /var/www/thedirk.org && hugo

# Backup Script
bash /home/dirk/.openclaw/workspace/scripts/backup-workspace.sh
```

---

*By Nix 🐧 & Dirk, 2026. "Das ist unser Ding."*
