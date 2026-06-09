#!/bin/bash
# Contentix History-Funktion (HIST) — DB-Migration v1.0
# Datum: 2026-06-09
# Spec: HISTORY-SPEC.md
# Ausführen: bash scripts/migrate-history-v1.sh
#
# Diese Migration ist idempotent — sie kann mehrfach ausgeführt werden.

set -e

DB_PATH="/home/dirk/contentix/contentix.db"
BACKUP_PATH="${DB_PATH}.bak-pre-hist-$(date +%Y%m%d-%H%M%S)"

echo "Contentix History-Migration v1.0"
echo "================================="

# 1. Backup
if [ -f "$DB_PATH" ]; then
    echo "[1/4] Backup der DB nach: $BACKUP_PATH"
    cp "$DB_PATH" "$BACKUP_PATH"
else
    echo "FEHLER: $DB_PATH nicht gefunden"
    exit 1
fi

# 2. Sanity-Check: ist parent_video_id schon da?
echo "[2/4] Prüfe ob parent_video_id Spalte schon existiert..."
HAS_COL=$(sqlite3 "$DB_PATH" "PRAGMA table_info(videos);" 2>/dev/null | grep -c "parent_video_id")
HAS_COL=${HAS_COL:-0}

if [ "$HAS_COL" -gt 0 ]; then
    echo "      parent_video_id existiert bereits — skippe ALTER TABLE"
else
    echo "      Füge parent_video_id Spalte hinzu..."
    sqlite3 "$DB_PATH" "ALTER TABLE videos ADD COLUMN parent_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL;"
    echo "      ✓ Spalte hinzugefügt"
fi

# 3. Index anlegen
echo "[3/4] Lege Index idx_videos_parent an..."
sqlite3 "$DB_PATH" "CREATE INDEX IF NOT EXISTS idx_videos_parent ON videos(parent_video_id);"
echo "      ✓ Index angelegt"

# 4. Report
echo "[4/4] Status-Report:"
echo "      Videos gesamt:        $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM videos;")"
echo "      Videos published:     $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM videos WHERE status='published';")"
echo "      Videos archiviert:    $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM videos WHERE status='archived';")"
echo "      Videos mit Remake:    $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM videos WHERE parent_video_id IS NOT NULL;")"
echo "      Skripte gesamt:       $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM scripts;")"
echo "      Skripte archiviert:   $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM scripts WHERE status='archived';")"

echo ""
echo "Migration erfolgreich. Backup liegt unter:"
echo "  $BACKUP_PATH"
echo ""
echo "Nächste Schritte:"
echo "  1. SQL: SELECT id, title, published_date FROM videos WHERE status='published' ORDER BY published_date DESC;"
echo "  2. Remake-Links manuell setzen via:"
echo "     UPDATE videos SET parent_video_id = <original_id> WHERE id = <remake_id>;"
echo "  3. Spec reviewen: HISTORY-SPEC.md"
