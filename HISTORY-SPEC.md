# Contentix — History-Funktion (HIST)

**Status:** Spec Draft v1.0
**Datum:** 2026-06-09
**Ticket:** HIST (Kanban #88)
**Autor:** Nix (für Dirk)
**Ziel-Release:** Contentix v1.0.0 (Major — neue Public-API)

---

## 1. Motivation

Contentix hat 6 mögliche `status`-Werte für Videos: `planned | research | script | recording | done | published`. Der Status `published` (= das Video ist live auf YouTube) ist nirgends im Kanban-Board sichtbar — nur im Kalender und in der Bibliothek. **22 Videos** mit `status='published'` fallen so durch die Workflow-Ansicht. Wir brauchen einen Platz dafür.

Gleichzeitig fehlt im Skripte-Bereich ein **Soft-Delete mit Wiederherstellung** (das `archived`-Status-Pattern ist da, aber die UI ist noch nicht ausgebaut).

---

## 2. Designentscheidungen (mit Dirk abgestimmt 2026-06-09)

### 2.1 Was ist "History"?
**Kombination aus Option B + D** (vgl. Kanban-Ticket):

- **B**: Eigenes View-Panel "History" (analog zu Kanban/Kalender/Bibliothek/Skripte) — Top-Level-Nav-Item in der Sidebar
- **D**: Innerhalb des History-Views ein **zeitbasierter Feed** "Was wurde wann veröffentlicht", gruppiert nach Jahr/Monat, neueste oben

### 2.2 Published-Videos: Board oder raus?
**Raus aus dem Board, rein in den History-View.**

- Kanban-Board fokussiert auf **aktive Produktion** (planned → done)
- History-View ist das Archiv + Feed
- Kalender und Bibliothek bleiben unverändert (published-Videos erscheinen weiterhin dort, weil das ihre Heimat ist)

### 2.3 Remake-Linking
**Ja, mit Einschränkung:**

- Neue Spalte `videos.parent_video_id` (TEXT, FK → videos.id, nullable)
- `parent_video_id` zeigt **immer auf das Original** (ältester Vorfahre in der Kette), nicht auf den direkten Vorgänger
- Zyklische Remakes (A→B→C→A) sind ausgeschlossen — `parent_video_id` ist "der erste Vorfahre"
- Beispiel-Kette:
  - Video A (Original, 2024): `parent_video_id = NULL`
  - Video B (Remake von A, 2025): `parent_video_id = A.id`
  - Video C (Remake von B, 2026): `parent_video_id = A.id` ← **immer Original**

**Use-Case:** Themen wie "Beste Linux-Distro für Gaming 2024/2025/2026" — alle zeigen auf das 2024-Original.

### 2.4 vidIQ-Sync
**Keine Änderung.** vidIQ ist "Published Truth":

- vidIQ-synced Videos bekommen automatisch `status='published'`, `video_id`, `published_date`, `youtube_url`
- Manuelles Überschreiben via UI **nicht möglich** (UI zeigt vidIQ-Daten als read-only)
- Power-User-Workaround: direkter DB-Zugriff oder vidIQ-Sync deaktivieren (außerhalb v1-Scope)
- Remake-Erkennung läuft manuell: User setzt `parent_video_id` selbst über Video-Edit-Modal

### 2.5 Retention / Soft-Delete
- **Default für Videos:** Soft-Delete via `status='archived'` (gleicher Mechanismus wie bei Skripten)
- **Default für Skripte:** Schon vorhanden (`status='archived'`)
- **Hard-Delete:** Nur aus dem Archiv heraus, manuell
- **Retention v1:** forever — keine Auto-Archive-Logik
- **Später (out of scope v1):** Retention-Policy (z. B. "archiviert nach 12 Monaten")

---

## 3. UI-Mockup

### 3.1 Sidebar (neues Nav-Item)

```
┌─────────────────────────────┐
│ Contentix                   │
├─────────────────────────────┤
│ 🏠 Bibliothek               │
│ 💡 Ideen (Kanban)           │
│ 📅 Kalender                 │
│ 📜 Skripte                  │
│ 📰 History           ← NEU │
│ ⚙️  Settings                │
└─────────────────────────────┘
```

### 3.2 History-View

```
┌────────────────────────────────────────────────────────────────┐
│ 📰 History                                       [+ Filter]   │
│ Veröffentlichte Videos — chronologisch, neueste zuerst         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ▼ 2026                                                         │
│    ┌────┬──────────────────────────────────────────────┐       │
│    │[📺]│ Alpha Protocol auf Linux spielen             │       │
│    │    │ veröffentlicht 15.04.2026 · 12.430 views    │       │
│    │    │ 📁 Games · 🔄 Remake von 2022          [⋯]   │       │
│    └────┴──────────────────────────────────────────────┘       │
│    ┌────┬──────────────────────────────────────────────┐       │
│    │[📺]│ Beste Linux-Distro für Gaming 2026          │       │
│    │    │ veröffentlicht 02.03.2026 · 45.221 views    │       │
│    │    │ 📁 Listen · 🔄 Remake von 2024          [⋯]   │       │
│    └────┴──────────────────────────────────────────────┘       │
│                                                                │
│  ▼ 2025                                                         │
│    ┌────┬──────────────────────────────────────────────┐       │
│    │[📺]│ NixVis: HTML-Diagramme für YouTube           │       │
│    │    │ veröffentlicht 28.12.2025 · 8.103 views      │       │
│    │    │ 📁 Projekte                            [⋯]   │       │
│    └────┴──────────────────────────────────────────────┘       │
│    ┌────┬──────────────────────────────────────────────┐       │
│    │[📺]│ Beste Linux-Distro für Gaming 2025          │       │
│    │    │ veröffentlicht 04.01.2025 · 38.992 views    │       │
│    │    │ 📁 Listen · 🔄 Remake von 2024          [⋯]   │       │
│    └────┴──────────────────────────────────────────────┘       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Card-Hover:** zeigt YouTube-Thumbnail in groß
**Card-Click:** öffnet Video-Detail-Modal (gleicher Editor wie im Board, aber `status='published'` ist sichtbar als read-only-Badge)
**Filter-Button:** Dropdown für "Alle", "Mit Remake", "Long-form", "Shorts", "Livestream"

### 3.3 Archiv-Ansicht (für Skripte UND Videos)

```
┌────────────────────────────────────────────────────────────────┐
│ 📦 Archiv                              [← zurück zum Hauptview]│
├────────────────────────────────────────────────────────────────┤
│ 22 Videos · 7 Skripte archiviert                              │
│                                                                │
│  Skripte:                                                       │
│    🗑️ Skript „Coole Idee v3"           Wiederherstellen  Löschen│
│    🗑️ Skript „Verworfenes Konzept"     Wiederherstellen  Löschen│
│    ...                                                          │
│                                                                │
│  Videos:                                                        │
│    🗑️ Video „Cancelled: Linux-Demo"    Wiederherstellen  Löschen│
│    ...                                                          │
└────────────────────────────────────────────────────────────────┘
```

**Soft-Delete:** Setzt `status='archived'`, Eintrag verschwindet aus Hauptviews
**Wiederherstellen:** Setzt `status` zurück (bei Videos: z. B. auf `done`, bei Skripten: auf `draft`)
**Hard-Delete:** Echtes DELETE aus der DB, mit Confirm-Dialog ("Wirklich unwiderruflich löschen?")

---

## 4. DB-Schema-Änderungen

### 4.1 `videos`-Tabelle — neue Spalte

```sql
ALTER TABLE videos ADD COLUMN parent_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL;
```

**Semantik:**
- `NULL` = Original (kein Remake)
- `parent_video_id = X` = Remake, zeigt auf das Original in der Kette (ältester Vorfahre)

**Index** für Performance:
```sql
CREATE INDEX IF NOT EXISTS idx_videos_parent ON videos(parent_video_id);
```

### 4.2 `videos`-Tabelle — keine weiteren Änderungen

- `status='published'` bleibt der finale Status (schon dokumentiert)
- `status='archived'` für Soft-Delete (gleicher Wert wie bei Skripten — einheitlich)
- Keine neue `archived_at`-Spalte nötig in v1 (Update-Timestamp `updated_at` reicht)

### 4.3 `scripts`-Tabelle — keine Schema-Änderung

`status='archived'` funktioniert schon, nur die UI dazu fehlt.

### 4.4 Neue API-Endpoints (v1.0)

| Method | Endpoint | Zweck |
|---|---|---|
| GET | `/api/history` | Liste aller `status='published'` Videos, sortiert nach `published_date DESC` |
| POST | `/api/videos/:id/archive` | Soft-Delete: setzt `status='archived'` |
| POST | `/api/videos/:id/restore` | Restore: setzt `status` auf vorherigen Wert (aus `nix_comment_source` oder User-Auswahl) |
| DELETE | `/api/videos/:id` | Hard-Delete: DELETE FROM videos WHERE id = ? (existiert schon, aber explizit dokumentieren) |
| GET | `/api/scripts?status=archived` | Liste archivierter Skripte (existiert schon via Query-Param) |
| POST | `/api/scripts/:id/archive` | Soft-Delete für Skripte (existiert) |
| POST | `/api/scripts/:id/restore` | Restore für Skripte (NEU) |

---

## 5. Migration-Plan für bestehende 22 published-Videos

### 5.1 Vorbereitung

```bash
# Backup der DB vor der Migration (Vorsicht)
cp /home/dirk/contentix/contentix.db /home/dirk/contentix/contentix.db.bak-pre-hist
```

### 5.2 Migrations-Schritte (manuell, einmalig)

**Schritt 1:** Schema-Migration — neue Spalte + Index
```sql
ALTER TABLE videos ADD COLUMN parent_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_videos_parent ON videos(parent_video_id);
```

**Schritt 2:** Sanity-Check — zeige alle published-Videos
```sql
SELECT id, title, published_date, parent_video_id
FROM videos
WHERE status = 'published'
ORDER BY published_date DESC;
```

→ Manuell prüfen: gibt es offensichtliche Remakes in der Liste, die verlinkt werden sollten? (z. B. "Beste Linux-Distro für Gaming" 2023/2024/2025)

**Schritt 3:** Remake-Links setzen (Dirk macht das manuell, später über Video-Edit-Modal)

Beispiel:
```sql
-- "Beste Linux-Distro für Gaming 2024" ist Original (id = 12)
-- "Beste Linux-Distro für Gaming 2025" ist Remake (id = 34)
UPDATE videos SET parent_video_id = 12 WHERE id = 34;
-- "Beste Linux-Distro für Gaming 2026" ist Remake (id = 56)
UPDATE videos SET parent_video_id = 12 WHERE id = 56;
```

**Schritt 4:** Verifizieren
```sql
-- Alle Remakes von Original id=12
SELECT id, title, published_date FROM videos WHERE parent_video_id = 12 ORDER BY published_date;
-- Sollte 2 Remakes zeigen, NICHT den Original
```

### 5.3 Was bei der Migration NICHT passiert

- **Keine Daten-Migration** für bestehende `published`-Videos in einen neuen Container — sie bleiben in der `videos`-Tabelle, nur der `status` bleibt `'published'`, der History-View filtert sie einfach heraus
- **Keine Auto-Archivierung** alter Daten
- **Kein Backfill** für `parent_video_id` — Dirk setzt das manuell, weil semantische Entscheidung

---

## 6. Akzeptanzkriterien

### 6.1 Funktional
- [ ] Sidebar zeigt neuen Nav-Item "History"
- [ ] History-View zeigt alle Videos mit `status='published'`, sortiert nach `published_date DESC`
- [ ] History-View gruppiert nach Jahr (collapsible sections)
- [ ] History-Card zeigt: Thumbnail, Titel, Datum, View-Count (von vidIQ), Tags, Remake-Hinweis
- [ ] Klick auf History-Card öffnet Video-Detail-Modal mit `status='published'` als read-only-Badge
- [ ] Video-Edit-Modal hat neues Feld "Remake von: [Dropdown mit allen Originalen]" → speichert `parent_video_id`
- [ ] Kanban-Board zeigt KEINE `status='published'` Videos mehr (Filter bleibt bestehen)
- [ ] Archiv-View (für Skripte + Videos) ist erreichbar (z. B. via Settings → "Archiv anzeigen" oder eigener Sub-Tab)
- [ ] Soft-Delete via Archiv-Button funktioniert für Videos und Skripte
- [ ] Restore aus dem Archiv funktioniert
- [ ] Hard-Delete nur aus dem Archiv, mit Bestätigungs-Dialog

### 6.2 API
- [ ] `GET /api/history` liefert published-Videos
- [ ] `POST /api/videos/:id/archive` funktioniert
- [ ] `POST /api/videos/:id/restore` funktioniert
- [ ] `POST /api/scripts/:id/restore` funktioniert
- [ ] Bestehende Endpoints (`GET/POST/PUT/DELETE /api/videos`, `/api/scripts`) unverändert

### 6.3 DB
- [ ] `parent_video_id` Spalte existiert
- [ ] Index `idx_videos_parent` existiert
- [ ] Keine breaking Schema-Änderungen

### 6.4 UI-Polish
- [ ] History-Card-Hover zeigt größeres Thumbnail
- [ ] Filter-Dropdown im History-View
- [ ] "Keine published Videos" Empty-State
- [ ] Responsive auf Mobile (History-Cards werden zu single-column)

---

## 7. Test-Plan

### 7.1 Manuelle Tests (Dirk)
1. **History-View lädt** — sollte alle 22 published-Videos zeigen
2. **Remake-Linking** — setze parent_video_id für 2 Test-Videos, prüfe History-View zeigt Remake-Hinweis
3. **Soft-Delete** — archiviere ein Video, prüfe Verschwinden aus Kanban + History, dann Restore
4. **Hard-Delete** — lösche ein Video aus dem Archiv, prüfe DB-Eintrag ist weg
5. **vidIQ-Sync** — neuer vidIQ-Sync soll KEINE manual-Override-Felder überschreiben (nur eigene)

### 7.2 API-Tests (curl / Playwright)
- [ ] `GET /api/history` → 200, Array mit published-Videos
- [ ] `POST /api/videos/:id/archive` → 200, status='archived' in DB
- [ ] `POST /api/videos/:id/restore` → 200, status zurück auf 'done' (default für published-videos die restored werden? → TODO: klären)
- [ ] `DELETE /api/videos/:id` → 200, kein DB-Eintrag mehr

### 7.3 Edge-Cases
- [ ] Was passiert, wenn ein Remake-Original gelöscht wird? → `ON DELETE SET NULL` → Remake wird zum neuen Original
- [ ] Was passiert, wenn vidIQ-Sync ein Video updated, das `parent_video_id` hat? → `parent_video_id` bleibt erhalten (nicht überschrieben)
- [ ] Was passiert mit dem Remake-Dropdown, wenn es 0 Originale gibt? → Dropdown leer, nur "— Kein Remake —" wählbar

---

## 8. Out of Scope (v1)

- Retention-Policy / Auto-Archivierung nach X Monaten
- Bulk-Archive (mehrere Videos auf einmal archivieren)
- Export der History als RSS / JSON-Feed
- Public-API für externe Tools
- vidIQ-Override-UI (Power-User-Feature)
- Multi-Remake-Trees (mehrere Ebenen — A → B → C, wo C.parent = B)
- "Trending"-Sortierung im History-View (z. B. nach Views)

---

## 9. Aufwandsschätzung (v1 Implementation)

| Task | Geschätzt |
|---|---|
| DB-Migration (Spalte + Index) | 5 Min |
| `GET /api/history` Endpoint | 15 Min |
| `POST /api/videos/:id/archive` + `restore` | 20 Min |
| `POST /api/scripts/:id/restore` | 10 Min |
| Sidebar-Nav-Item + History-View-Skelett | 30 Min |
| History-Card-Rendering (HTML, CSS) | 1.5h |
| Video-Edit-Modal: Remake-Dropdown | 1h |
| Archiv-View (Skripte + Videos) | 2h |
| Soft-Delete / Restore / Hard-Delete UI-Logik | 1.5h |
| Filter-Dropdown im History-View | 30 Min |
| Empty-States + Mobile-Responsive | 1h |
| Tests + Polish | 2h |
| **Gesamt** | **~10-12h** |

→ 2-3 Sessions, kein Sprint.

---

## 10. Quellen

- Kanban-Ticket HIST (#88), Subtasks 40–45
- AGENTS.md § Status Field (Pipeline)
- README.md § Kanban-Board
- Memory `2026-06-03.md` 11:55 (Status-Pipeline-Session)
- Daily-Memory `2026-05-13.md` (18 published-Videos Cleanup)
- Daily-Memory `2026-06-09.md` (Konzept-Session mit Dirk)

---

_"By Nix & Dirk, 2026. There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors."_ 🐧
