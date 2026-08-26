# Contentix v1 — Frontend-UX-Review (Nix/main, 2026-08-26)

> **Methodik:** Manuelle Sicht (Designbot-Run wurde nicht persistiert). Gelesen wurden
> `frontend/index.html`, `frontend/styles.css`, `frontend/store.js`, `frontend/calendar.js`
> (Working Tree) + Mockup-Vergleich via `image`-Tool (4 PNGs in
> `mockup/bibliothek-v2-*.png` und `lib-*.png`).

## 1. Stärken

### Theme-System ist exzellent
- **5 Jahreszeiten-Themes** (`Nix-Violett` Default, `theme-spring`, `theme-summer`,
  `theme-autumn`, `theme-winter`) — alle als CSS-Variablen, semantisch benannt.
- Konsistente Token-Namen (`--nix-violet`, `--bg-deep`, `--text-primary`, `--shadow-md`).
- Verwendung von `color-mix(in srgb, ...)` für Hover-Variants statt separater Hex-Codes.
- Playfair Display (Serif) + Inter (Sans) + JetBrains Mono — typografische Hierarchie
  ist durchdacht.

### Tastatur-Shortcuts sind dokumentiert und UI-affordant
- `+` / `n` → neue Karte
- `Cmd/Ctrl + K` → Command-Palette (mit eigener UI!)
- `1`-`5` → Status direkt setzen (im Modal)
- `?` → Help-Overlay (sichtbar als eigenes Modal)
- ARIA-Attribute gesetzt (`role="dialog"`, `aria-label`)

### State-Store ist sauber entkoppelt
- Frontend kommuniziert ausschließlich via `store.select` / `store.actions` (siehe
  ADR-001) — keine direkten `fetch()`-Calls in den View-Files sichtbar.
- Optimistic-Updates mit Rollback (siehe qabot-Coverage-Bericht zu Test-Lücken).

### Empty-States sind vorbereitet
- Bibliothek zeigt `<p class="bibliothek-subtitle">Lädt...</p>`
- History: `<div class="history-empty"><p>Lade History…</p></div>`
- Content-Grid: `<div class="loading__spinner">` + Text
- Hero: `display: none` Default, füllt sich erst wenn Daten da

### Next-Video-Widget in Sidebar
- "Nächstes Video" — prominenter Anker für tägliche Nutzung
- Direkt im sichtbaren Bereich, nicht im Main-Content vergraben

## 2. Konsistenz-Probleme (priorisiert)

### P0 — Sichtbare Bugs in Mockup-vs-Live-Vergleich

**U1. Titel-Trunkierung mit Ellipsis**
- Mockup (lib-cards-rest.png): "Linux Gaming intensiv: Goverla…"
- Live (bibliothek-v2-live.png): "Linux-Umzug: Wo sind meine…"
- Problem: Titel werden mit `text-overflow: ellipsis` abgeschnitten statt umzubrechen.
- Empfehlung: `-webkit-line-clamp: 2` mit `display: -webkit-box` für 2-zeiligen
  Umbruch. Aktuell wirkt es, als wäre das Design kaputt.

**U2. Doppelte Cards zwischen "Letzte 6" und "Evergreens"**
- "Linux Gaming intensiv", "Windows vs. Linux", "Linux-Umzug", "Faugus Launcher",
  "Linux ballert" tauchen in beiden Sektionen auf.
- Mockup zeigt das NICHT — Mockup hat 13 unterschiedliche Videos.
- Problem: Sortier-Logik überschneidet sich. "Evergreens" sollte Filter `views > 1000`
  ODER Exclusion der letzten 6 haben.
- Empfehlung: Filterregel definieren + Test.

**U3. Hook-Annotationen wirken generisch**
- "Kürzestes Video im Slot" — das ist eine Metrik, kein Hook.
- "Top 10% aller deiner Videos" — besser, aber nicht personalisiert.
- Vergleich mit Mockup: dort steht "Wenn ich ein Lieblings-Video wählen müsste: das hier."
  → persönliche Stimme, nicht Metrik.
- Empfehlung: Hook-Templates überarbeiten, mehr Persönlichkeit reinbringen.

**U4. Keine echten Thumbnails in Live**
- Mockup: identische Gradient-Placeholder (gewollt)
- Live: identische Gradient-Placeholder (ungewollt?)
- Frage an Dirk: Sollen die `thumbnail_url`-Felder aus DB geladen werden? Der Code
  in `vidiq_video_cache` speichert Thumbnails — sie werden nur nicht im UI verwendet.

### P1 — Working Tree

**U5. `frontend/calendar.{js,css}` modifiziert, nicht committed**
- Risiko: Lokale Änderungen laufen, sind aber nicht im Repo.
- Empfehlung: Committen mit CHANGELOG-Eintrag ODER zurückziehen.

### P2 — Konsistenz-Drift

**U6. Datums-Format inkonsistent**
- Footer zeigt "09. Juni 2026" UND "29. Mai 2026" (zweistellig + einstellig je Monat).
- Sollte einheitlich sein: `de-DE` Locale-Funktion, immer zweistellig.

**U7. Sidebar-KPIs ohne Trendpfeile**
- 1.4K / 71.7K / 1.9K / 26 — pure Zahlen, kein ↑↓ Vergleich zum Vormonat.
- Würde mehr Wert liefern für monatliche Reviews.

**U8. History-Badge zeigt "0"**
- Sieht aus wie "du hast keine History" — verwirrend wenn es stimmt, da Dirk definitiv
  veröffentlichte Videos hat. Frage: Was zählt in "History"?

**U9. vidIQ Refresh prominenter als nötig**
- Volle Breite unten in der Sidebar, konkurriert mit Navigation.
- 1× täglich reicht, nicht bei jedem View-Wechsel sichtbar nötig.

## 3. Mockup-vs-Live-Vergleich

| Aspekt | Mockup (Desktop) | Live |
|---|---|---|
| **Hero-Card** | Lila→blau Gradient + 🎬 Icon | Blau-violetter Gradient + 🎬 Icon ✅ |
| **NEUESTER RELEASE Badge** | Lila Pill + Stern | "NEUESTER RELEASE" Plain Badge ✅ |
| **Hook-Style** | Orange Border-Left + kursiv | Hellvioletter Callout mit Akzentlinie — **abweichend** ⚠️ |
| **Card-Layout** | 3×2 Grid, gleiche Höhe | 3×2 Grid, ähnlich ✅ |
| **Card-Annotationen** | Orange Hooks wie "🌶️ Ehrlich? Hat mich überrascht" | Grau/Orange-Hooks mit Emoji 🌶️/📈 |
| **Footer-Counter** | "Alle 13 Videos anzeigen →" | "Alle 39 Videos anzeigen →" ✅ |
| **Filter-Pill** | "Hooks: Alle" | "🪝 Hooks: Alle" (Emoji-Variante) |
| **Hover-State** | Dunkelblau/schwarz + helle Schrift | (nicht im Mockup-Live-Vergleich getestet) |
| **Card-Höhen** | konsistent | konsistent ✅ |

**Wichtigste Abweichung:** Hook-Style. Mockup zeigt **orange Border-Left mit kursivem
Zitat**, Live zeigt **hellvioletter Callout mit Akzentlinie links**. Beides valide, aber
das Live-System hat einen etwas "weicheren" Charakter — die Mockup-Energie ist direkter.

## 4. Calendar-Working-Tree

Aus dem `frontend/calendar.js` Working-Tree (nicht committed):
- Lokaler State: `currentDate`, `currentView`, `selectedDay`, `weekIndex` — Module-Globals.
- `getAllCards()` ist Store-Wrapper (gut, ADR-001-konform).
- `ensureCalendarSubscribed()` — einmaliges Subscribe-Pattern, korrekt.
- `MAX_VISIBLE_PER_BUCKET = 3` — gute UX-Entscheidung, verhindert Card-Overflow.

**Verdikt:** Working Tree ist **substanziell gut**, vermutlich Refactor zur
Store-Migration (Phase 3). Sollte committed werden mit klarem Changelog-Eintrag.

**Frage:** Ist der Code vollständig oder noch in Arbeit?

## 5. Quick-Wins (<2h)

1. **Titel-Trunkierung fixen** (`-webkit-line-clamp: 2` in `bibliothek.js` CSS, ~30 Min)
2. **Doppelte Cards filtern** (`app.js` oder `bibliothek.js`, Evergreens-Logik,
   ~45 Min inkl. Test)
3. **Datums-Format vereinheitlichen** (`utils.js`-Helper, ~15 Min)
4. **Sidebar-KPIs mit Trendpfeilen** (HTML + CSS, ~1h)
5. **Hook-Templates überarbeiten** (`app.js` + 5–10 Templates, ~30 Min)

## 6. Übergabe an qabot

Diese Komponenten brauchen Test-Coverage (lückenlose UI-Tests):

- **Card-Trunkierung:** Render-Test mit langem Titel → erwarte 2 Zeilen + Ellipsis
- **Drag-and-Drop Status-Update:** Kanban-Card drag → Backend-Call → erwartete Update
- **Filter-Pill "Hooks: Alle":** Click → erwartete Filterung
- **Calendar-Navigation:** Monat/Week-Switch → erwartete Re-Render
- **Theme-Switch:** Settings → 5 Themes → erwarte CSS-Var-Änderung sichtbar
- **Sidebar-Stats:** Refresh → erwartete Werte aus `/api/vidiq/stats`

---

*By Nix 🐧, 2026-08-26. "Be resourceful, not performative."*