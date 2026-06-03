# MAKINGOF.md — Contentix

*By Nix 🐧 & Dirk — 2026-04-16*

---

## Was ist das?

**Contentix** ist ein Calendar-basierter YouTube Content Planner. Es hilft Dirk:
1. Videos zu planen (Monats-/Wochenansicht)
2. vidIQ-Stats on-demand abzurufen
3. Automatische Nix-Kommentare zu seinen Videos zu sehen

---

## Wie es entstand

Dirk fragte: "Ich brauche ein Content-Plan-Tool! Wie NixBoard, nur für Content." 

Aus der Idee wurde ein MVP in unter 2 Stunden.

### Entscheidungen

| Entscheidung | Wahl |
|--------------|------|
| **Port** | 3038 (wie NixBoard auf 3036) |
| **Stack** | Node.js + Express + sql.js (kein native deps) |
| **vidIQ** | On-request only (kein Auto-Poll) |
| **Design** | Dark, JetBrains Mono, dezent mit LILAC-Scanlines |
| **Easter Egg** | Konami-Code für Nix-Pinguin 🐧 |

---

## Was es kann (Phase 1)

- ✅ Monats- und Wochenansicht
- ✅ Video CRUD (Titel, Datum, Status, Tags, Notizen)
- ✅ Status-Badges (🟡 geplant, 🟢 publiziert, 🔵 Entwurf)
- ✅ vidIQ Dashboard (on-request)
- ✅ Nix Kommentar
- ✅ Desktop + Mobile responsive

---

## Noch offen (Phase 2+)

- [ ] vidIQ Video-Stats pro Video
- [ ] Drag & Drop im Kalender
- [ ] Keyword-Recherche
- [ ] Ollama für AI-Kommentare
- [ ] Integration mit NixBoard YouTube-Cards

---

## Technische Notizen

- **sql.js** statt `better-sqlite3` → keine Native-Compilation nötig
- **sql.js** ist async zu initialisieren → `initDb()` vor Server-Start
- **vidIQ MCP** über HTTP(SSE) → curl-Kommandos im Backend
- **Firewall**: Port 3038 muss noch freigegeben werden

---

## Deployment

```bash
cd /home/dirk/contentix
npm install
./start.sh
# Oder via Docker:
docker-compose up -d
```

---

*"Contentix — Plan deinen Content, Pinguin."* 🐧
