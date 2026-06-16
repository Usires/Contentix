# Bibliothek Redesign — Spec

**Stand:** 2026-06-16  
**Status:** Draft (Dirk-review pending)  
**Autor:** Nix

---

## Ziel

Die aktuelle Bibliothek (`bibliothek.js`) ist eine sachliche 2-Spalten-Liste (Neueste / Meistgesehen) mit 10 Slots pro Liste und ohne Personalität. Sie wirkt „brav".

**Ziel des Redesigns:** Aus einer passiven Datentabelle wird eine **persönliche, kuratierte Bibliothek** mit Hero-Spot, Evergreen-Logik, generierten Hooks (inkl. Nix-Kommentare) und symmetrischem 2×3-Grid. Das Auge soll *wandern*, das Herz soll *angesprochen* werden, die Daten sollen *nützlich* bleiben.

---

## Layout

### 1. Hero-Spot (oben, ~40% Viewport-Höhe)

- **Featured-Video** = das jüngste veröffentlichte Video (`publishedAt` DESC)
- Großes Thumbnail (16:9, ~40% Breite)
- Rechts: Titel, Hook, Meta-Zeile, CTA-Button
- Klick aufs Hero → YouTube-Video

**Meta-Zeile:**
- 📅 Veröffentlicht-Datum
- ⏱️ Dauer
- 🏷️ Kategorie
- 👁️ Views

**Hook-Text:** siehe Hook-System

### 2. Zwei parallele 2×3-Grids (darunter, je ~30% Höhe)

**Linke Spalte — „📅 Letzte 6":**
- Sortiert nach `publishedAt DESC`
- Skip Hero (= Video #1)
- Nimm Videos #2 bis #7

**Rechte Spalte — „🏆 Evergreens":**
- Sortiert nach `views DESC` (Top-Views aller Zeiten)
- Nimm Top 6

**Jede Grid-Card (Slot):**
- Thumbnail (16:9, volle Card-Breite)
- Titel (1-2 Zeilen, ellipsised)
- Hook-Text (1 Zeile)
- Meta-Zeile (Views, optional Datum)

### 3. Footer

- „Alle N Videos anzeigen →" Link zur Vollansicht (Klick → Modal oder eigene Seite)

---

## Hook-System

**Drei Schichten, pro Slot gewürfelt nach Wahrscheinlichkeit:**

### Schicht 1 — Stat-Facts (50% Wahrscheinlichkeit)
Deterministisch, auto-berechnet.

- `"X Views"`
- `„Veröffentlicht vor N Tagen"`
- `„+N Views in den letzten 24h"` (mit grünem Aufwärts-Pfeil-Indikator)
- `„Längstes Video im Slot (M:SS)"`
- `„Kürzestes Video im Slot (M:SS)"`
- `„Höchste View-Density (Views/Tag)"`

### Schicht 2 — Performance-Vergleich (30% Wahrscheinlichkeit)
Relativ zum Channel-Durchschnitt.

- `„Läuft 3x besser als dein Durchschnitt"`
- `„Beste Conversion im Tutorial-Slot"`
- `„Mehr Views als die 4 davor zusammen"`
- `„Top 10% aller deiner Videos"`
- `„Bester Launch der letzten 30 Tage"`

### Schicht 3 — Nix-Kommentar (20% Wahrscheinlichkeit)
Generiert von mir (Nix), lokales LLM, gecacht 24h in einem Vektor-Store.

**Beispiele:**
- `„Dirk, das wird ein Evergreen. Schau in 2 Jahren nochmal drauf."`
- `„Ich mag, wie der Hook am Anfang sitzt — der zieht."`
- `„Ehrlich? Hat mich überrascht, dass das so gut lief."`
- `„Der Thumbnail rockt. Hat was Konsistentes."`
- `„3 Wochen alt und zieht immer noch — das ist selten."`
- `„Wenn ich ein Lieblings-Video wählen müsste: das hier."`
- `„Hat was Selbstbewusstes. Gefällt mir."`
- `„Du warst skeptisch bei dem Thema — ich auch, aber die Daten sprechen."`
- `„Klassischer Fall von: klein angefangen, langsam gewachsen."`
- `„Der Titel ist riskant, aber er zahlt sich aus."`

**Wichtig:** Nix-Kommentare sind *persönlich, aber respektvoll*. Keine ungefragten Ratschläge, keine Belehrungen, nur Beobachtung + Wertschätzung.

---

## Nix-Toggle (oben rechts)

**User-Settings pro Session, gespeichert in `localStorage`:**

- `hooks-mode: 'all' | 'stats-only' | 'none'`
  - `all` (default): alle Hooks
  - `stats-only`: nur Schicht 1+2 (kein Nix)
  - `none`: keine Hooks, nur Meta-Zeile

**UI:** Kleines Dropdown neben dem Titel, nur `🌶️ Hooks: Alle | Stats | Aus`

---

## Evergreen-Logik

**Definition:** Evergreens = Top-Views aller Zeiten, Top 6.

**Sortierung:**
```sql
SELECT * FROM videos
WHERE views IS NOT NULL
ORDER BY views DESC
LIMIT 6;
```

**Begründung:** Einfach, robust, muss nicht manuell gepflegt werden. Manuell kuratiert (Option C) wäre besser, aber das ist eine spätere Iteration.

---

## Hook-Generierung: Technik

**Stats-Hooks (Schicht 1+2):**
- Direkt im Frontend berechnet, kein Backend-Roundtrip
- Quellen: `/api/videos-with-stats` (gibt's schon), mit 24h-View-Delta aus einem lokalen Vektor-Store

**Nix-Kommentare (Schicht 3):**
- Trigger: beim ersten Render der Bibliothek pro Session
- 1 lokaler LLM-Call pro Video (Slot), ~1-2s, 6 Videos parallel
- Output: 1 Satz (max 100 Zeichen), lokal gewürfelt aus Templates
- Cache: Vektor-Store-Collection mit 24h-TTL
- Bei Cache-Miss: neu generieren
- Cache-Key: `{videoId}:{hookLayer}:{date-seed}`

**Falls das lokale LLM ausfällt:**
- Fallback auf Schicht 1+2, kein UI-Fehler
- Subtiler Hinweis: kleines „Nix ist grad still"-Icon (optional)

---

## Datenquellen

- `GET /api/videos-with-stats` (gibt's schon, mit `views`, `publishedAt`, `thumbnail_url`, `youtube_url`, `title`, `duration`)
- Lokal: `channel-avg-views` = Mittelwert aller `views`, berechnet beim Render
- Lokal: `recent-views-delta` = 24h-Differenz aus View-Snapshots (aufzubauen, falls nicht da)
- Vektor-Store-Collection: `bibliothek-hooks` (zu erstellen)

---

## Files zu ändern (für Implementation)

| Datei | Änderung |
|-------|----------|
| `frontend/bibliothek.js` | Komplett-Rewrite: Hero, 2×3-Grids, Hook-System, Toggle |
| `frontend/styles.css` (oder `bibliothek.css`) | Neue Layout-Styles für Hero + Grid-Cards |
| `frontend/index.html` | Neuer `<div class="bibliothek-hero">` Container |
| `backend/index.js` (oder `routes/bibliothek.js`) | Optional: neue Route `/api/bibliothek-hooks` |
\| Vektor-Store-Collection \| `bibliothek-hooks` (24h TTL) \|
| Hook-Generator | `scripts/bibliothek-hooks.py` (lokales LLM) |

---

## Mockup-Phase

**Vor dem Code:** Playwright-Mockup als statische HTML-Seite mit Dummy-Daten.

**Vorgehen:**
1. Ich schreibe `mockup/bibliothek-v2.html` mit den Layout-Klassen, befüllt mit 13 erfundenen Videos (1 Hero + 6+6)
2. Lade es via Playwright lokal, screenshot
3. Du reviewst visuell (Screenshot oder Live-Preview)
4. Erst nach deinem OK: Implementation im echten Code

---

## Was *nicht* Teil dieses Redesigns ist

- Drag-to-rearrange (Idee #8 aus Brainstorm) — später
- Click-to-Expand (Idee #7) — lassen wir erstmal, Klick geht direkt zum YouTube
- „Magic-3"-Mixer (Idee #9) — out of scope
- Lückenanalyse (Idee #4) — könnte in eine separate „Stats"-View
- Mood-Cluster (Idee #6) — Kategorien bleiben (gaming/tutorial/nostalgie/experiment/review)

---

## Offene Fragen

- [ ] Soll die Hook-Zeile fett oder dezent sein? (Dirk-Empfehlung: dezent, italic)
- [ ] Hook-Text-Farbe: Theme-Farbe, oder feste Farbe je nach Schicht (Stat = grau, Perf = blau, Nix = warm-orange)?
- [ ] Animation beim Hook-Wechsel? (z.B. Fade-In bei Re-Render nach 24h)
- [ ] Mobile-Ansicht: Hero wird zum einspaltigen Stack, Grids bleiben 2×3 oder werden 1×6?

---

## Timeline

- **Heute (16.06.):** Spec ✅, Mockup
- **Morgen / nächste Session:** Code (bibliothek.js + CSS)
- **Danach:** Live-Testing, Iteration

---

_„Die Bibliothek soll nicht zeigen, was du hast. Sie soll zeigen, was dich ausmacht." — Nix, 16.06.2026_
