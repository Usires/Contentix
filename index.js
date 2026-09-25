const express = require('express');
const initSqlJs = require('sql.js');
const { execSync } = require('child_process');
const youtubeApi = require('./youtube-api');  // Phase 2: YouTube Data API client
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// ─── Logging ────────────────────────────────────────────────────────────────
// LOG_LEVEL: 'info' (default) | 'debug' | 'silent'
//   info  — startup, lifecycle events, errors
//   debug — every API hit, every spawned sub-process
//   silent — nothing except FATAL
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_FILE = path.join(__dirname, 'data', 'contentix.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;     // rotate at 5 MB
const LOG_KEEP_GENERATIONS = 3;            // keep contentix.log.1 .. .3

function logTimestamp() { return new Date().toISOString(); }
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_BYTES) return;
    // Rotate: .2 → .3, .1 → .2, current → .1, drop old .3
    for (let i = LOG_KEEP_GENERATIONS; i >= 1; i--) {
      const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const dst = `${LOG_FILE}.${i}`;
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
      fs.renameSync(src, dst);
    }
  } catch (e) {
    console.error('[contentix] log rotation failed:', e.message);
  }
}
function writeLogFile(level, args) {
  if (LOG_LEVEL === 'silent') return;
  const line = `[${logTimestamp()}] [${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) { /* read-only filesystem — console logging still works */ }
}
const log = {
  info:  (...a) => { console.log (logTimestamp(), '[info]', ...a);  writeLogFile('INFO',  a); },
  warn:  (...a) => { console.warn(logTimestamp(), '[warn]', ...a);  writeLogFile('WARN',  a); },
  error: (...a) => { console.error(logTimestamp(), '[error]', ...a); writeLogFile('ERROR', a); },
  debug: (...a) => { if (LOG_LEVEL === 'debug') { console.log(logTimestamp(), '[debug]', ...a); writeLogFile('DEBUG', a); } },
};

// (vidIQ removed in v0.13.x — see CHANGELOG.md. The legacy /api/vidiq/* routes
//  return 410 Gone with a pointer to /api/youtube/*.)
const PORT = process.env.PORT || 3038;
const API = `http://localhost:${PORT}/api`;

app.use(express.json());

// Global JSON error handler (vor allen Routes): kaputtes JSON -> sauberes 400 JSON
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body', detail: err.message });
  }
  next(err);
});

app.use(express.static(path.join(__dirname, 'frontend')));

// ─── Database Setup ────────────────────────────────────────────────────────────

let db;
// DB location:
//   - If DATA_DIR is set, the .db lives in <DATA_DIR>/contentix.db (Docker).
//   - Otherwise it lives next to index.js (local dev: simpler, zero config).
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'contentix.db')
  : path.join(__dirname, 'contentix.db');
if (process.env.DATA_DIR) {
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
}

async function initDB() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'planned',
        planned_date TEXT,
        published_date TEXT,
        video_id TEXT,
        youtube_url TEXT,
        tags TEXT,
        notes TEXT,
        nix_comment TEXT,
        nix_comment_source TEXT DEFAULT 'manual',
        owner TEXT DEFAULT 'dirk',
        position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Migrations: add new columns to existing DBs
    const videoCols = db.exec("PRAGMA table_info(videos)")[0]?.values.map(r => r[1]) || [];
    if (!videoCols.includes('owner')) {
      try { db.run("ALTER TABLE videos ADD COLUMN owner TEXT DEFAULT 'dirk'"); log.info('Migration: added owner column to videos'); } catch(e) { log.error('Migration videos.owner failed:', e.message); }
    }
    // vidiq_cache and vidiq_video_cache were removed in v0.13.x (vidIQ → YouTube
    // Data API migration). Older DBs get them dropped by the migration block
    // further below; fresh DBs never see them.
    db.run(`
      CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        folder TEXT DEFAULT 'scripts',
        status TEXT DEFAULT 'draft',
        content TEXT DEFAULT '',
        video_id TEXT,
        video_format TEXT DEFAULT 'longform',
        tags TEXT DEFAULT '[]',
        position INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // vidiq_refresh_jobs was removed in v0.13.x. Older DBs get it dropped by
    // the migration block further below; fresh DBs never see it.
    saveDB();
  }
  // YouTube Data API v3 cache tables (Phase 2 — replaces vidIQ as primary data source)
  db.run(`
    CREATE TABLE IF NOT EXISTS youtube_cache (
      channel_id TEXT PRIMARY KEY,
      data TEXT,
      fetched_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS youtube_video_cache (
      video_id TEXT PRIMARY KEY,
      data TEXT,
      fetched_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS youtube_refresh_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      current_step TEXT,
      result TEXT,
      error TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: vidi_suggestions + vidi_runs (v0.14, 2026-09-17)
  // Vidi 2.0 — proactive topic-discovery + script-drafting service.
  // Suggestions are created by the Vidi service (cron-triggered), approved/rejected
  // by the user via Contentix UI. vidi_runs is observability for the service.
  db.run(`
    CREATE TABLE IF NOT EXISTS vidi_suggestions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      hook_line TEXT,
      why_now TEXT,
      research_cites TEXT,
      script_skeleton TEXT,
      confidence_score REAL DEFAULT 0.0,
      source TEXT,
      target_channel_id TEXT,
      status TEXT DEFAULT 'inbox',
      created_at TEXT DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_by TEXT,
      video_id TEXT,
      metadata TEXT
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_vidi_suggestions_status ON vidi_suggestions(status, created_at DESC)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS vidi_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      mode TEXT,
      items_found INTEGER DEFAULT 0,
      items_pushed INTEGER DEFAULT 0,
      error TEXT,
      duration_ms INTEGER,
      metadata TEXT
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_vidi_runs_started ON vidi_runs(started_at DESC)`);

  // Migration (v0.13.x): drop legacy vidIQ tables. Phase 2 (commit a61327e,
  // 2026-09-XX) replaced vidIQ MCP with the self-hosted YouTube MCP. Fresh
  // DBs never create vidiq_* tables; older DBs that still have them get
  // them dropped here. Safe to run repeatedly: IF EXISTS makes this a
  // no-op on fresh DBs.
  db.run(`DROP TABLE IF EXISTS vidiq_cache`);
  db.run(`DROP TABLE IF EXISTS vidiq_video_cache`);
  db.run(`DROP TABLE IF EXISTS vidiq_refresh_jobs`);
  // Migration: research_jobs for Vidi/Nix-Research-Trigger (v0.10, 2026-06-11)
  db.run(`CREATE TABLE IF NOT EXISTS research_jobs (
    job_id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress_message TEXT DEFAULT '',
    result TEXT,
    error TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  )`);
  // Performance-Index für GET /api/research?videoId=X
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_research_jobs_video_id ON research_jobs(video_id)`); } catch(e) {}
  // Index für Status-Filter (List-View)
  try { db.run(`CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON research_jobs(status)`); } catch(e) {}
  saveDB();
}

function run(sql, ...params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function getAll(sql, ...params) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function get(sql, ...params) {
  const results = getAll(sql, ...params);
  return results[0] || null;
}

// Atomic DB write: temp file + rename + backup. Prevents corruption from
// mid-write crashes (power loss, OOM, disk full). POSIX rename() is atomic.
let _saveInFlight = false;
let _savePending = false;

function saveDB() {
  // Coalesce concurrent save requests. If a save is already running, queue
  // one more so the latest state lands on disk (no pile-up of writes).
  if (_saveInFlight) { _savePending = true; return; }
  _doSaveDB();
}

function _doSaveDB() {
  _saveInFlight = true;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = DB_PATH + '.tmp';
    const bakPath = DB_PATH + '.bak';

    // 1. Write to temp file (sync, fails loud if disk is full)
    fs.writeFileSync(tmpPath, buffer);

    // 2. Atomic rename (POSIX guarantee)
    fs.renameSync(tmpPath, DB_PATH);

    // 3. Backup of last-known-good (fire-and-forget; never block main save)
    try { fs.copyFileSync(DB_PATH, bakPath); } catch (e) { /* non-fatal */ }
  } catch (e) {
    log.error('saveDB failed:', e.message);
    // Best-effort: if tmp is left behind, clean it up next time
    try { fs.unlinkSync(DB_PATH + '.tmp'); } catch (e2) { /* ignore */ }
    throw e;
  } finally {
    _saveInFlight = false;
    if (_savePending) { _savePending = false; _doSaveDB(); }
  }
}

// ─── autoMatchYTCache (post-Phase-2, post-vidiQ-removal) ──────────────────────

function autoMatchVidiq(cardId, youtubeUrl, needsTitle, needsThumb) {
  // v0.13.x: vidIQ removed entirely. We now only consult the YouTube cache.
  // Cold videos get filled by the YouTube bulk-warmup endpoint; this function
  // is a best-effort sync fill from the local cache only.
  if (!youtubeUrl) return;
  const vidMatch = youtubeUrl.match(/(?:v=|\/youtu\.be\/)([^&\s?]+)/);
  if (!vidMatch) return;
  const vid = vidMatch[1];
  try {
    const ytCached = getCachedYouTubeVideo(vid);
    if (ytCached) {
      _applyThumbAndTitleToVideo(cardId, {
        title: ytCached.title,
        thumbnail: ytCached.thumbnail || ytCached.thumbnailUrl,
      }, needsTitle, needsThumb);
      return;
    }
    // No sync fallback to vidIQ cache (table dropped). The bulk-warmup endpoint
    // populates the YouTube cache asynchronously for new videos.
  } catch (err) { console.error('Auto-match YouTube cache error:', err.message); }
}

// Helper extracted from autoMatchVidiq — keeps title/thumbnail update logic in one place
function _applyThumbAndTitleToVideo(cardId, data, needsTitle, needsThumb) {
  if (!data) return;
  const upds = []; const p = [];
  if (needsTitle && data.title) { upds.push('title = ?'); p.push(data.title); }
  if (needsThumb && data.thumbnail) { upds.push('thumbnail_url = ?'); p.push(data.thumbnail); }
  if (upds.length > 0) { p.push(cardId); run(`UPDATE videos SET ${upds.join(', ')} WHERE id = ?`, ...p); saveDB(); }
}

// ─── Routes: Scripts CRUD ─────────────────────────────────────────────────────

app.get('/api/scripts', (req, res) => {
  try {
    const scripts = getAll('SELECT * FROM scripts ORDER BY folder ASC, position ASC, created_at ASC');
    const parsed = scripts.map(s => ({
      ...s,
      tags: s.tags ? JSON.parse(s.tags) : []
    }));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// IMPORTANT: static routes like /api/scripts/folders MUST be defined BEFORE /api/scripts/:id
// otherwise Express treats "folders" as an :id parameter and returns 404.
app.get('/api/scripts/folders', (req, res) => {
  try {
    const rows = getAll('SELECT DISTINCT folder FROM scripts ORDER BY folder ASC');
    res.json(rows.map(r => r.folder));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scripts/:id', (req, res) => {
  try {
    const script = get('SELECT * FROM scripts WHERE id = ?', req.params.id);
    if (!script) { res.status(404).json({ error: 'Script not found' }); return; }
    const parsed = { ...script, tags: script.tags ? JSON.parse(script.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scripts', (req, res) => {
  try {
    const { title, slug, folder = 'scripts', status = 'draft', content = '', video_id = null, video_format = 'longform', tags = [], position = 0 } = req.body;
    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();
    run(
      `INSERT INTO scripts (id, title, slug, folder, status, content, video_id, video_format, tags, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, title, slug, folder, status, content, video_id, video_format, JSON.stringify(tags), position, now, now
    );
    // Return the full record so the frontend store's createScript action
    // can replace its optimistic insert with the server-side truth.
    // (ADR-001 + Phase 2 migration, 2026-06-25)
    const created = get('SELECT * FROM scripts WHERE id = ?', id);
    res.json({ ...created, tags: created.tags ? JSON.parse(created.tags) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Shared UPDATE helper. Builds a safe UPDATE statement from a list of
// (column, value) pairs, restricted to an allowlist of columns so callers
// can't smuggle SQL through req.body keys. Returns the updated row, or
// null if no column was set (no-op).
//
// Special-case columns (those needing pre-processing like JSON.stringify)
// are handled by the caller passing already-encoded values; this keeps the
// helper generic across tables that don't share the same column needs.
function applyUpdate(table, id, fields, allowedColumns, preEncode = {}) {
  const updates = [];
  const params = [];
  for (const col of allowedColumns) {
    if (!(col in fields) || fields[col] === undefined) continue;
    updates.push(`${col} = ?`);
    params.push(preEncode[col] ? preEncode[col](fields[col]) : fields[col]);
  }
  if (updates.length === 0) {
    // No-op: return the current row if it exists, else null
    return get(`SELECT * FROM ${table} WHERE id = ?`, id);
  }
  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  run(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`, ...params);
  saveDB();
  return get(`SELECT * FROM ${table} WHERE id = ?`, id);
}

// Allowlist of columns each table accepts via UPDATE. Single source of
// truth for the API surface — adding a new column means one line here
// plus the schema migration.
const SCRIPT_COLUMNS = ['title', 'slug', 'folder', 'status', 'content', 'video_id', 'video_format', 'tags', 'position'];
const VIDEO_COLUMNS = ['title', 'status', 'video_format', 'thumbnail_url', 'planned_date', 'published_date', 'video_id', 'youtube_url', 'tags', 'notes', 'nix_comment', 'nix_comment_source', 'owner', 'script_id', 'position'];
// Map of columns whose value needs JSON encoding before SQL.
const JSON_ENCODE_COLUMNS = { tags: JSON.stringify };

app.put('/api/scripts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updated = applyUpdate('scripts', id, req.body, SCRIPT_COLUMNS, JSON_ENCODE_COLUMNS);
    // Return the full updated record so optimistic-update flows in the
    // frontend store can reconcile without a follow-up GET. Previously
    // this returned `{status: 'ok'}`, which caused the store to overwrite
    // the full record with that stub. (ADR-001 + Phase 2 migration, 2026-06-25)
    res.json({ ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/scripts/:id', (req, res) => {
  try {
    const existing = get('SELECT * FROM scripts WHERE id = ?', req.params.id);
    if (!existing) { res.status(404).json({ error: 'Script nicht gefunden' }); return; }
    run('DELETE FROM scripts WHERE id = ?', req.params.id);
    // Return the deleted record so the frontend store's deleteScript
    // action's rollback path has a snapshot. (ADR-001 + Phase 3, 2026-06-25)
    res.json({ ...existing, tags: existing.tags ? JSON.parse(existing.tags) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Import Script from .md file
app.post('/api/scripts/import', (req, res) => {
  try {
    const { filePath, folder = 'scripts' } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    const fullPath = filePath.startsWith('/') ? filePath : '/home/dirk/yt-research/' + filePath;
    const content = require('fs').readFileSync(fullPath, 'utf8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : require('path').basename(fullPath, '.md');
    const baseName = require('path').basename(fullPath, '.md');
    const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|\-$)/g, '');
    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();
    run(`INSERT INTO scripts (id, title, slug, folder, status, content, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`, id, title, slug, folder, content, now, now);
    res.json({ id, title, slug, status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: Videos CRUD ───────────────────────────────────────────────────────

app.get('/api/videos', (req, res) => {
  try {
    let videos;
    if (req.query.status) {
      videos = getAll('SELECT * FROM videos WHERE status = ? ORDER BY planned_date ASC, created_at ASC', req.query.status);
    } else {
      videos = getAll('SELECT * FROM videos ORDER BY planned_date ASC, created_at ASC');
    }
    const parsed = videos.map(v => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      notes: v.notes || '',
      nix_comment: v.nix_comment || '',
      nix_comment_source: v.nix_comment_source || 'manual',
      owner: v.owner || 'dirk',
      script_id: v.script_id || ''
    }));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const video = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!video) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    const parsed = { ...video, tags: video.tags ? JSON.parse(video.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/videos-with-stats → videos enriched with vidIQ stats (views, likes, publishedAt)
app.get('/api/videos-with-stats', async (req, res) => {
  try {
    const videos = getAll('SELECT * FROM videos ORDER BY published_date DESC, created_at DESC');
    const enriched = [];
    
    for (const v of videos) {
      const parsed = { ...v, tags: v.tags ? JSON.parse(v.tags) : [] };
      
      // Try to get YouTube cache stats (vidIQ removed in v0.13.x)
      if (v.video_id) {
        try {
          let ytCached = null;
          try { ytCached = getCachedYouTubeVideo(v.video_id); } catch(e) {}

          if (ytCached) {
            parsed.views = ytCached.views || 0;
            parsed.likes = ytCached.likes || 0;
            parsed.publishedAt = ytCached.publishedAt || null;
            parsed.duration = ytCached.duration || null;
            parsed.commentCount = ytCached.comments || ytCached.commentCount || 0;
            parsed.thumbnail = ytCached.thumbnail || null;
          } else {
            parsed.views = 0;
            parsed.likes = 0;
            parsed.thumbnail = null;
          }
        } catch(e) {
          parsed.views = 0;
          parsed.likes = 0;
        }
      } else {
        parsed.views = 0;
        parsed.likes = 0;
      }
      
      enriched.push(parsed);
    }
        // Fire-and-forget warmup for missing YouTube stats
        const needsWarmup = enriched.filter(v => v.video_id && !v.thumbnail).slice(0, 20);
        if (needsWarmup.length > 0) {
          setImmediate(() => {
            for (const v of needsWarmup) {
              youtubeApi.getVideoStats(v.video_id)
                .then(data => saveCachedYouTubeVideo(v.video_id, data))
                .catch(e => log.debug('[youtube] warmup failed for ' + v.video_id + ':', e.message));
            }
          });
        }


    
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/videos', (req, res) => {
  try {
    const {
      title, status = 'planned', video_format = 'longform', thumbnail_url = '',
      planned_date = null, published_date = null,
      video_id = null, youtube_url = null, tags = [], notes = '',
      nix_comment = '', nix_comment_source = 'manual', owner = 'dirk', position = 0,
      script_id = ''
    } = req.body;
    
    const id = require('crypto').randomUUID();
    const now = new Date().toISOString();
    
    run(
      `INSERT INTO videos (id, title, status, video_format, thumbnail_url, planned_date, published_date, video_id, youtube_url, tags, notes, nix_comment, nix_comment_source, owner, position, script_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, title, status, video_format, thumbnail_url, planned_date, published_date, video_id, youtube_url,
      JSON.stringify(tags), notes, nix_comment, nix_comment_source, owner, position, script_id, now, now
    );
    saveDB();
    
    // Feature 2: Auto-match for published + youtube_url
    if (status === 'published' && youtube_url) {
      const card = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
      const needsTitle = !card.title || card.title.trim() === '';
      const needsThumb = !card.thumbnail_url || card.thumbnail_url.trim() === '';
      if (needsTitle || needsThumb) autoMatchVidiq(id, youtube_url, needsTitle, needsThumb);
    }

    
    const video = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!video) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    const parsed = { ...video, tags: video.tags ? JSON.parse(video.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Locked video guard: synced-from-YouTube rows are immutable from user edits.
// Status / title / youtube_url / video_id / published_date / thumbnail_url /
// created_at / is_locked cannot be edited through PATCH or PUT once locked.
// Other edit-rejection behavior (delete, etc.) is out of scope for now.
const LOCKED_VIDEO_FIELDS = ['status', 'title', 'youtube_url', 'video_id', 'published_date', 'thumbnail_url', 'created_at', 'is_locked'];
function rejectLockedEdits(existing, body, res) {
  if (!existing.is_locked) return false;
  const rejected = [];
  for (const field of LOCKED_VIDEO_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field) && body[field] !== existing[field]) {
      rejected.push(field);
    }
  }
  if (rejected.length > 0) {
    res.status(423).json({
      error: 'Video ist gelockt (von YouTube synchronisiert). Diese Felder können nicht manuell geändert werden: ' + rejected.join(', '),
      lockedFields: rejected,
      videoId: existing.video_id,
    });
    return true;
  }
  return false;
}

app.put('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, youtube_url } = req.body;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    if (rejectLockedEdits(existing, req.body, res)) return;
    const updated = applyUpdate('videos', id, req.body, VIDEO_COLUMNS, JSON_ENCODE_COLUMNS);
    if (!updated) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }

    // Feature 2: Auto-match when published + youtube_url present
    if (status === 'published' && youtube_url) {
      const card = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
      const needsTitle = !card.title || card.title.trim() === '';
      const needsThumb = !card.thumbnail_url || card.thumbnail_url.trim() === '';
      if (needsTitle || needsThumb) autoMatchVidiq(id, youtube_url, needsTitle, needsThumb);
    }

    const parsed = { ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    if (rejectLockedEdits(existing, req.body, res)) return;
    const updated = applyUpdate('videos', id, req.body, VIDEO_COLUMNS, JSON_ENCODE_COLUMNS);
    if (!updated) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    const parsed = { ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    run('DELETE FROM videos WHERE id = ?', id);
    saveDB();
    // Return the deleted record so the frontend store's deleteVideo action
    // can keep its rollback snapshot aligned. (ADR-001 + Phase 3, 2026-06-25)
    res.json({ ...existing, tags: existing.tags ? JSON.parse(existing.tags) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Legacy /api/vidiq/* routes (deprecated since v0.13.x, removed 2026-10-31) ───
// All /api/vidiq/* URLs respond with 410 Gone + a pointer to the YouTube Data
// API equivalents. Catches any old client, bookmark, or web search result that
// still tries the old endpoints. Real replacement routes live under
// /api/youtube/* (see the YouTube Data API section above).
app.all('/api/vidiq/*', (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', '2026-10-31');
  res.set('Link', '</api/youtube/channel-stats>; rel="successor-version"');
  res.status(410).json({
    error: 'vidIQ integration removed',
    detail: 'This endpoint was removed in v0.13.x. Use /api/youtube/* instead.',
    successor: '/api/youtube/channel-stats',
    sunset: '2026-10-31',
    docs: 'https://github.com/Usires/Contentix/blob/main/CHANGELOG.md',
  });
});

// ─── Routes: vidIQ ─────────────────────────────────────────────────────────────


// GET /api/vidiq/balance-live → live credit balance from vidIQ MCP, no cache read.
// `vidiq_balance` is a tool read (current docs: 0 credits per call on this account;
// treat any nonzero cost as a possible billing surprise — wrap in the catch below).
// Writes the result into the existing `vidiq_cache.balance` blob so any later
// cache-based pre-flight sees a fresh value. Idempotent; safe to spam.
//
// Why this exists: the pre-flight gate in refreshVidiq() reads /api/vidiq/stats
// and bails if `balance.total ≤ 0`. If the cached balance blob is empty/{} or
// otherwise stale (the "0-Credit-Loop"), this route is the way out: it forces
// a fresh read and self-heals the cache for the next refresh.

// GET /api/vidiq/channel-stats → subs, views, watchtimeHours, videoCount + latest video

// GET /api/vidiq/watchtime → estimated watch time (minutes → hours), cached 6h.
// Costs 5 vidIQ credits on a cache miss; cache hit is free.
// 28-day rolling window. Pairs with vidiq_channel_analytics.

// --- YouTube cache settings (mutable in-memory, persisted to app_settings on save)
const YT_DEFAULTS = {
  channelTtlHours: 1,
  videoTtlHours: 24,
  analyticsTtlHours: 24,
  refreshMaxVideos: 10,
  refreshMinIntervalMinutes: 5,
};

let YT_CACHE_SETTINGS = { ...YT_DEFAULTS };

// Load persisted settings on startup (moved into initDB().then() below
// — the DB isn't ready at module-load time, so loading here would
// always fail with "Cannot read properties of undefined (reading 'prepare')".)

function saveYTSettings() {
  for (const [key, value] of Object.entries(YT_CACHE_SETTINGS)) {
    run("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
        'yt.' + key, String(value));
  }
  saveDB();
}

// --- Generic cache helper (REFA-Punkt 1: dedup of channel/video/analytics patterns)
// Reads a row by key, parses the JSON blob, returns null if missing or stale.
function getCached({ table, keyCol, keyVal, ttlMs }) {
  const rows = getAll(
    `SELECT data, fetched_at FROM ${table} WHERE ${keyCol} = ?`,
    keyVal
  );
  if (rows.length === 0) return null;
  const ageMs = Date.now() - new Date(rows[0].fetched_at + 'Z').getTime();
  if (ageMs > ttlMs) return null;
  try { return JSON.parse(rows[0].data); }
  catch (e) { return null; }
}

// Upserts a JSON blob at (table, keyCol, keyVal). Caller passes the parsed object.
function saveCached({ table, keyCol, keyVal, data }) {
  run(
    `INSERT OR REPLACE INTO ${table} (${keyCol}, data, fetched_at) VALUES (?, ?, datetime("now"))`,
    keyVal, JSON.stringify(data)
  );
  saveDB();
}

// --- YouTube cache helpers (thin wrappers over getCached/saveCached)
function getCachedYouTubeChannel(channelId) {
  return getCached({
    table: 'youtube_cache',
    keyCol: 'channel_id',
    keyVal: channelId,
    ttlMs: YT_CACHE_SETTINGS.channelTtlHours * 60 * 60 * 1000,
  });
}

function saveCachedYouTubeChannel(channelId, data) {
  saveCached({ table: 'youtube_cache', keyCol: 'channel_id', keyVal: channelId, data });
}

function getCachedYouTubeVideo(videoId) {
  return getCached({
    table: 'youtube_video_cache',
    keyCol: 'video_id',
    keyVal: videoId,
    ttlMs: YT_CACHE_SETTINGS.videoTtlHours * 60 * 60 * 1000,
  });
}

function saveCachedYouTubeVideo(videoId, data) {
  saveCached({ table: 'youtube_video_cache', keyCol: 'video_id', keyVal: videoId, data });
}

// Analytics is special: it lives inside the channel cache under `_analytics`.
// This is a side-effect of OAuth-token-resolved analytics being scoped to the
// channel while still benefiting from the youtube_cache TTL. We keep the
// savedAt inside the JSON blob so callers can introspect freshness.
function getCachedYouTubeAnalytics(channelId) {
  const cached = getCached({
    table: 'youtube_cache',
    keyCol: 'channel_id',
    keyVal: channelId,
    ttlMs: YT_CACHE_SETTINGS.analyticsTtlHours * 60 * 60 * 1000,
  });
  if (!cached || !cached._analytics) return null;
  return cached._analytics;
}

function saveCachedYouTubeAnalytics(channelId, analytics) {
  // Merge with existing channel cache so we don't clobber _channel data.
  const rows = getAll('SELECT data FROM youtube_cache WHERE channel_id = ?', channelId);
  const existing = rows.length > 0 ? JSON.parse(rows[0].data) : {};
  existing._analytics = Object.assign({}, analytics, { savedAt: new Date().toISOString() });
  saveCached({ table: 'youtube_cache', keyCol: 'channel_id', keyVal: channelId, data: existing });
}

const YT_CHANNEL_ID_FOR_STATS = 'UC-YmLEIgdESaoVN3ZKNT_QA';

// --- YouTube routes

// GET /api/youtube/channel-stats
app.get('/api/youtube/channel-stats', (req, res) => {
  const channelId = req.query.channelId || YT_CHANNEL_ID_FOR_STATS;
  const cached = getCachedYouTubeChannel(channelId);
  if (cached) {
    const rows = getAll('SELECT fetched_at FROM youtube_cache WHERE channel_id = ?', channelId);
    const fetchedAt = rows[0] ? rows[0].fetched_at : null;
    return res.json({
      subs: cached.subscribers || 0,
      views: cached.views || 0,
      videoCount: cached.videos || 0,
      title: cached.title || '',
      customUrl: cached.customUrl || '',
      thumbnail: cached.thumbnail || '',
      cached: true,
      _fetched_at: fetchedAt,
    });
  }
  res.json({ subs: 0, views: 0, videoCount: 0, cached: false });
});

// POST /api/youtube/refresh -- async job
let ytRefreshCancelToken = null;
app.post('/api/youtube/refresh', (req, res) => {
  const channelId = req.query.channelId || YT_CHANNEL_ID_FOR_STATS;
  const jobId = require('crypto').randomUUID();
  run('INSERT INTO youtube_refresh_jobs (job_id, status, progress, total, started_at) VALUES (?, ?, ?, ?, datetime("now"))',
      jobId, 'pending', 0, 4);
  saveDB();
  res.json({ jobId, status: 'pending' });

  ytRefreshCancelToken = new AbortController();
  runYouTubeRefresh(jobId, channelId, ytRefreshCancelToken.signal).catch(err => {
    log.error('[youtube] refresh error:', err.message);
  });
});

app.get('/api/youtube/refresh/status/:jobId', (req, res) => {
  const rows = getAll('SELECT * FROM youtube_refresh_jobs WHERE job_id = ?', req.params.jobId);
  if (rows.length === 0) return res.status(404).json({ error: 'job not found' });
  const j = rows[0];
  res.json({
    jobId: j.job_id,
    status: j.status,
    progress: j.progress,
    total: j.total,
    currentStep: j.current_step,
    result: j.result ? JSON.parse(j.result) : null,
    error: j.error,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
  });
});

app.delete('/api/youtube/refresh/:jobId', (req, res) => {
  if (ytRefreshCancelToken) ytRefreshCancelToken.abort();
  run('UPDATE youtube_refresh_jobs SET status = ?, finished_at = datetime("now") WHERE job_id = ?',
      'cancelled', req.params.jobId);
  saveDB();
  res.json({ ok: true });
});

// POST /api/youtube/video-stats/:videoId
app.post('/api/youtube/video-stats/:videoId', async (req, res) => {
  const videoId = req.params.videoId;
  try {
    const data = await youtubeApi.getVideoStats(videoId);
    saveCachedYouTubeVideo(videoId, data);
    res.json({ ok: true, data, cached: false });
  } catch (e) {
    res.status(502).json({ error: 'youtube video stats failed: ' + e.message });
  }
});

// GET /api/youtube/analytics -- 28d watchtime + subs-gained
app.get('/api/youtube/analytics', (req, res) => {
  const channelId = req.query.channelId || YT_CHANNEL_ID_FOR_STATS;
  const days = parseInt(req.query.days || '28', 10);
  const cached = getCachedYouTubeAnalytics(channelId);
  if (cached) {
    return res.json({
      minutes: cached.minutes,
      hours: Math.round(cached.minutes / 60),
      averageViewDuration: cached.averageViewDuration,
      subscribersGained: cached.subscribersGained,
      views: cached.views,
      windowDays: days,
      cached: true,
      fetchedAt: cached.savedAt,
    });
  }
  res.json({ cached: false, windowDays: days });
});

// POST /api/youtube/bulk-warmup — kicks off a background job that warms YouTube
// stats for ALL videos without cache data. Called from the frontend when the
// Bibliothek tab loads for the first time, so the Top-Views-All-Time list
// eventually fills up. Job runs in the background, status is tracked in the
// existing youtube_refresh_jobs table so the frontend can poll progress.
app.post('/api/youtube/bulk-warmup', async (req, res) => {
  const channelId = req.query.channelId || YT_CHANNEL_ID_FOR_STATS;
  const force = req.query.force === 'true';

  const allVideos = getAll("SELECT id, video_id FROM videos WHERE video_id IS NOT NULL AND video_id != '' AND status != 'archived'");
  const needsWarmup = force ? allVideos : allVideos.filter(v => !getCachedYouTubeVideo(v.video_id));

  if (needsWarmup.length === 0) {
    return res.json({ ok: true, status: 'noop', message: 'all videos already cached', remaining: 0 });
  }

  const jobId = require('crypto').randomUUID();
  run("INSERT INTO youtube_refresh_jobs (job_id, status, progress, total, started_at) VALUES (?, 'running', 0, ?, datetime('now'))",
      jobId, needsWarmup.length);
  saveDB();
  res.json({ ok: true, status: 'started', jobId, total: needsWarmup.length });

  // Background loop with up to 5 parallel workers
  setImmediate(async () => {
    const CONCURRENCY = 5;
    let done = 0;
    let failed = 0;
    const updateProgress = (step) => {
      run("UPDATE youtube_refresh_jobs SET progress = ?, current_step = ? WHERE job_id = ?", done, step, jobId);
      saveDB();
    };
    updateProgress('Bulk-Warmup: 0/' + needsWarmup.length + ' Videos');

    const queue = [...needsWarmup];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const v = queue.shift();
        if (!v) break;
        try {
          const data = await youtubeApi.getVideoStats(v.video_id);
          saveCachedYouTubeVideo(v.video_id, data);
          done++;
          if (done % 5 === 0 || done === needsWarmup.length) {
            updateProgress('Bulk-Warmup: ' + done + '/' + needsWarmup.length + ' Videos');
          }
        } catch (e) {
          failed++;
          log.debug('[youtube] bulk-warmup failed for ' + v.video_id + ':', e.message);
        }
      }
    });
    await Promise.all(workers);

    run("UPDATE youtube_refresh_jobs SET status = 'done', progress = ?, finished_at = datetime('now'), current_step = ? WHERE job_id = ?",
        done, 'Fertig. ' + done + ' Videos gecachedt' + (failed > 0 ? ', ' + failed + ' fehlgeschlagen' : '') + '.', jobId);
    saveDB();
    log.info('[youtube] bulk-warmup fertig: ' + done + '/' + needsWarmup.length + ' (failed: ' + failed + ')');
  });
});

// POST /api/youtube/warm-cache/:videoId — fire-and-forget cache fill for a single video
// Used by the frontend when the user opens History (or any view with cold videos)
// so the user sees stats appear gradually instead of all-at-once or never.
app.post('/api/youtube/warm-cache/:videoId', async (req, res) => {
  const videoId = req.params.videoId;
  // Respond immediately, do the work in the background
  res.json({ ok: true, videoId, status: 'warming' });
  setImmediate(async () => {
    try {
      // Skip if already cached and fresh
      if (getCachedYouTubeVideo(videoId)) return;
      const data = await youtubeApi.getVideoStats(videoId);
      saveCachedYouTubeVideo(videoId, data);
      log.debug('[youtube] warmed cache for', videoId);
    } catch (e) {
      log.warn('[youtube] warm-cache failed for ' + videoId + ':', e.message);
    }
  });
});

// POST /api/youtube/cache-settings
app.post('/api/youtube/cache-settings', (req, res) => {
  try {
    const body = req.body || {};
    if (Number.isFinite(body.channel)) YT_CACHE_SETTINGS.channelTtlHours = body.channel;
    if (Number.isFinite(body.video)) YT_CACHE_SETTINGS.videoTtlHours = body.video;
    if (Number.isFinite(body.analytics)) YT_CACHE_SETTINGS.analyticsTtlHours = body.analytics;
    if (Number.isFinite(body.maxVideos)) YT_CACHE_SETTINGS.refreshMaxVideos = body.maxVideos;
    if (Number.isFinite(body.interval)) YT_CACHE_SETTINGS.refreshMinIntervalMinutes = body.interval;
    saveYTSettings();
    res.json({ ok: true, settings: YT_CACHE_SETTINGS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/youtube/cache-settings', (req, res) => {
  res.json(YT_CACHE_SETTINGS);
});

// ─── Vidi 2.0 Routes (Phase 1.1, 2026-09-17) ────────────────────────────────
// These routes are Contentix-side. The Vidi 2.0 service runs as a separate
// process (default port 8191) and pushes suggestions via /api/vidi/inbox
// (POST from the service, or directly INSERT from a Contentix-CLI).
//
// Detection: GET /api/vidi/status tries to reach the service. If unreachable,
// returns { installed: false } gracefully. Contentix UI hides Vidi-related
// UI when installed === false. Contentix is fully functional without Vidi.

// GET /api/vidi/status — Health-Check + Detection
// Tries to reach Vidi service at VIDI_URL (env, default http://localhost:8191).
// Returns: { installed, version, url, lastRun, nextRun, queueDepth, modelsAvailable }
// Always 200 (graceful when Vidi not installed).
app.get('/api/vidi/status', async (req, res) => {
  const vidiUrl = process.env.VIDI_URL || 'http://localhost:8191';
  let vidiRes = null;
  let vidiStatus = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    vidiRes = await fetch(`${vidiUrl}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    if (vidiRes.ok) {
      vidiStatus = await vidiRes.json();
    }
  } catch (e) {
    // Vidi not installed or unreachable — graceful fallback
  }

  // Pull last run from DB (independent of service availability)
  const lastRunRow = get('SELECT * FROM vidi_runs ORDER BY started_at DESC LIMIT 1');
  const nextRunEstimate = lastRunRow && lastRunRow.finished_at
    ? new Date(new Date(lastRunRow.finished_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  if (!vidiStatus) {
    res.json({
      installed: false,
      url: vidiUrl,
      lastRun: lastRunRow ? lastRunRow.started_at : null,
      nextRun: nextRunEstimate,
      queueDepth: 0,
      modelsAvailable: [],
    });
    return;
  }

  res.json({
    installed: true,
    version: vidiStatus.version || 'unknown',
    url: vidiUrl,
    lastRun: lastRunRow ? lastRunRow.started_at : vidiStatus.lastRun || null,
    nextRun: vidiStatus.nextRun || nextRunEstimate,
    queueDepth: vidiStatus.queueDepth || 0,
    modelsAvailable: vidiStatus.modelsAvailable || [],
  });
});

// GET /api/vidi/inbox?status=inbox&limit=20 — List suggestions
// Status filter: inbox (default), approved, rejected, archived
app.get('/api/vidi/inbox', (req, res) => {
  try {
    const { status = 'inbox', limit = 20 } = req.query;
    const allowed = ['inbox', 'approved', 'rejected', 'archived'];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      return;
    }
    const rows = getAll(
      `SELECT * FROM vidi_suggestions WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      status, parseInt(limit, 10) || 20
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vidi/inbox/:id/approve — Approve a suggestion
// Creates a videos row with status='research' and links it.
// Body (optional): { userId?: string, channelId?: string }
app.post('/api/vidi/inbox/:id/approve', (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'dirk', channelId = null } = req.body || {};
    const suggestion = get('SELECT * FROM vidi_suggestions WHERE id = ?', id);
    if (!suggestion) { res.status(404).json({ error: 'Suggestion nicht gefunden' }); return; }
    if (suggestion.status !== 'inbox') {
      res.status(409).json({ error: `Suggestion ist bereits ${suggestion.status}`, suggestion });
      return;
    }

    // Cooldown: keine zwei approvals für dieselbe suggestion gleichzeitig
    if (suggestion.video_id) {
      const existingVideo = get('SELECT id FROM videos WHERE id = ?', suggestion.video_id);
      if (existingVideo) {
        // Update link if already created (idempotent)
        run(
          `UPDATE vidi_suggestions SET status = 'approved', decided_at = datetime('now'), decided_by = ? WHERE id = ?`,
          userId, id
        );
        res.json({ status: 'approved', videoId: existingVideo.id, suggestion });
        return;
      }
    }

    // Create new videos row with status='research'
    const videoId = require('crypto').randomUUID();
    const now = new Date().toISOString();
    const targetChannel = channelId || suggestion.target_channel_id || null;
    run(
      `INSERT INTO videos (
        id, title, status, planned_date, published_date, video_id, youtube_url,
        tags, notes, nix_comment, nix_comment_source, owner, script_id, position,
        created_at, updated_at
      ) VALUES (?, ?, 'research', ?, ?, ?, ?, '[]', '', ?, 'vidi', 'dirk', '', 0, ?, ?)`,
      videoId,
      suggestion.title,
      null, null, null, null,
      `Source: ${suggestion.source || 'vidi'} | Score: ${suggestion.confidence_score || 0}`,
      now, now
    );

    run(
      `UPDATE vidi_suggestions SET status = 'approved', decided_at = datetime('now'), decided_by = ?, video_id = ? WHERE id = ?`,
      userId, videoId, id
    );

    res.json({ status: 'approved', videoId, suggestion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vidi/inbox/:id/reject — Reject a suggestion
// Body (optional): { userId?: string, reason?: string }
app.post('/api/vidi/inbox/:id/reject', (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'dirk', reason = '' } = req.body || {};
    const suggestion = get('SELECT * FROM vidi_suggestions WHERE id = ?', id);
    if (!suggestion) { res.status(404).json({ error: 'Suggestion nicht gefunden' }); return; }
    if (suggestion.status !== 'inbox') {
      res.status(409).json({ error: `Suggestion ist bereits ${suggestion.status}` });
      return;
    }

    // Update metadata with rejection reason (don't lose info)
    let metadata = {};
    try { metadata = suggestion.metadata ? JSON.parse(suggestion.metadata) : {}; } catch (e) {}
    metadata.rejectionReason = reason;
    metadata.rejectedBy = userId;

    run(
      `UPDATE vidi_suggestions SET status = 'rejected', decided_at = datetime('now'), decided_by = ?, metadata = ? WHERE id = ?`,
      userId, JSON.stringify(metadata), id
    );
    res.json({ status: 'rejected', suggestion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vidi/inbox — Insert a new suggestion (called by Vidi service or CLI)
// Body: { title, hook_line?, why_now?, research_cites?, script_skeleton?, confidence_score?, source?, target_channel_id?, metadata? }
app.post('/api/vidi/inbox', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) { res.status(400).json({ error: 'title required' }); return; }
    const id = require('crypto').randomUUID();
    run(
      `INSERT INTO vidi_suggestions (
        id, title, hook_line, why_now, research_cites, script_skeleton,
        confidence_score, source, target_channel_id, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?)`,
      id,
      body.title,
      body.hook_line || null,
      body.why_now || null,
      body.research_cites ? JSON.stringify(body.research_cites) : null,
      body.script_skeleton || null,
      body.confidence_score || 0.0,
      body.source || null,
      body.target_channel_id || null,
      body.metadata ? JSON.stringify(body.metadata) : null
    );
    res.json({ id, status: 'inbox', created_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vidi/runs — Observability (last N discovery-runs)
app.get('/api/vidi/runs', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const rows = getAll(
      `SELECT * FROM vidi_runs ORDER BY started_at DESC LIMIT ?`,
      parseInt(limit, 10) || 10
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vidi/runs — Insert a run record (called by Vidi service)
// Body: { id?, mode?, items_found?, items_pushed?, error?, duration_ms?, metadata? }
app.post('/api/vidi/runs', (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id || require('crypto').randomUUID();
    run(
      `INSERT OR REPLACE INTO vidi_runs (
        id, started_at, finished_at, status, mode, items_found, items_pushed, error, duration_ms, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      body.started_at || new Date().toISOString(),
      body.finished_at || null,
      body.status || 'running',
      body.mode || 'discovery',
      body.items_found || 0,
      body.items_pushed || 0,
      body.error || null,
      body.duration_ms || null,
      body.metadata ? JSON.stringify(body.metadata) : null
    );
    res.json({ id, status: body.status || 'running' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vidi/settings — Returns Vidi-related settings from app_settings
app.get('/api/vidi/settings', (req, res) => {
  try {
    const keys = [
      'vidi.ollamaUrl',
      'vidi.ollamaPrimaryModel',
      'vidi.ollamaReasoningModel',
      'vidi.ollamaAgentModel',
      'vidi.cloudFallbackEnabled',
      'vidi.discoveryCron',
      'vidi.discoveryEnabled',
      'vidi.defaultChannelId',
    ];
    const rows = getAll(`SELECT key, value FROM app_settings WHERE key LIKE 'vidi.%'`);
    const out = {};
    for (const r of rows) {
      const key = r.key.replace('vidi.', '');
      // Try to JSON-parse, fall back to raw string
      try { out[key] = JSON.parse(r.value); } catch { out[key] = r.value; }
    }
    // Defaults for unset keys
    if (!out.ollamaUrl) out.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:12434';
    if (!out.ollamaPrimaryModel) out.ollamaPrimaryModel = 'qwen3.5:latest';
    if (!out.ollamaReasoningModel) out.ollamaReasoningModel = 'gemma4:12b';
    if (!out.ollamaAgentModel) out.ollamaAgentModel = 'ornith:latest';
    if (out.cloudFallbackEnabled === undefined) out.cloudFallbackEnabled = true;
    if (!out.discoveryCron) out.discoveryCron = '0 9 * * *';
    if (out.discoveryEnabled === undefined) out.discoveryEnabled = true;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vidi/settings — Update Vidi-related settings
// Body: { ollamaUrl?, ollamaPrimaryModel?, cloudFallbackEnabled?, discoveryCron?, discoveryEnabled?, defaultChannelId? }
app.post('/api/vidi/settings', (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date().toISOString();
    const updates = [];
    if (body.ollamaUrl !== undefined) updates.push(['vidi.ollamaUrl', body.ollamaUrl]);
    if (body.ollamaPrimaryModel !== undefined) updates.push(['vidi.ollamaPrimaryModel', body.ollamaPrimaryModel]);
    if (body.ollamaReasoningModel !== undefined) updates.push(['vidi.ollamaReasoningModel', body.ollamaReasoningModel]);
    if (body.ollamaAgentModel !== undefined) updates.push(['vidi.ollamaAgentModel', body.ollamaAgentModel]);
    if (body.cloudFallbackEnabled !== undefined) updates.push(['vidi.cloudFallbackEnabled', JSON.stringify(!!body.cloudFallbackEnabled)]);
    if (body.discoveryCron !== undefined) updates.push(['vidi.discoveryCron', body.discoveryCron]);
    if (body.discoveryEnabled !== undefined) updates.push(['vidi.discoveryEnabled', JSON.stringify(!!body.discoveryEnabled)]);
    if (body.defaultChannelId !== undefined) updates.push(['vidi.defaultChannelId', body.defaultChannelId]);
    for (const [k, v] of updates) {
      run(`INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, k, v, now);
    }
    res.json({ updated: updates.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Refresh job implementation
async function runYouTubeRefresh(jobId, channelId, signal) {
  const updateJob = (status, progress, currentStep, result, error) => {
    const resultJson = result ? JSON.stringify(result) : null;
    run("UPDATE youtube_refresh_jobs SET status = ?, progress = ?, current_step = ?, result = ?, error = ?, finished_at = CASE WHEN ? IN ('done', 'failed', 'cancelled') THEN datetime('now') ELSE finished_at END WHERE job_id = ?",
        status, progress, currentStep || null, resultJson, error || null, status, jobId);
    saveDB();
  };

  try {
    updateJob('running', 1, 'Lade Kanal-Stats...');
    if (signal.aborted) throw new Error('aborted');
    const channelStats = await youtubeApi.getChannelStats(channelId);
    saveCachedYouTubeChannel(channelId, channelStats);

    updateJob('running', 2, 'Lade eigene Videos...');
    if (signal.aborted) throw new Error('aborted');
    let videoCount = 0;
    let videosImported = 0;
    try {
      const recentVideos = await youtubeApi.getMyRecentVideos(YT_CACHE_SETTINGS.refreshMaxVideos);
      for (const v of recentVideos) {
        if (signal.aborted) throw new Error('aborted');
        try {
          const videoStats = await youtubeApi.getVideoStats(v.videoId);
          saveCachedYouTubeVideo(v.videoId, Object.assign({}, v, videoStats));
          videoCount++;

          // Auto-Import: if this YouTube video isn't yet in our videos table,
          // INSERT a locked published row from the live YouTube data.
          // (Replaces the vidIQ Phase-1 pattern that lived in runVidiqRefresh.)
          const existing = getAll('SELECT id FROM videos WHERE video_id = ?', v.videoId);
          if (existing.length === 0) {
            try {
              const publishedAt = v.publishedAt || (videoStats && videoStats.publishedAt) || null;
              const publishedIso = publishedAt ? new Date(publishedAt).toISOString() : null;
              const newId = require('crypto').randomUUID();
              const now = new Date().toISOString();
              const thumbnail = v.thumbnail || (videoStats && videoStats.thumbnail) || '';
              const title = v.title || (videoStats && videoStats.title) || '(unbenannt)';
              run(`INSERT INTO videos (
                id, title, status, video_format, thumbnail_url,
                planned_date, published_date, video_id, youtube_url, tags,
                notes, nix_comment, nix_comment_source, owner, position, script_id,
                is_locked, created_at, updated_at
              ) VALUES (?, ?, 'published', ?, ?, ?, ?, ?, ?, '[]', '', '', 'manual', 'dirk', 0, '', 1, ?, ?)`,
                newId, title, 'longform', thumbnail,
                null, publishedIso, v.videoId, `https://youtube.com/watch?v=${v.videoId}`,
                now, now);
              videosImported++;
              log.info('[youtube] auto-imported new published video: ' + v.videoId + ' (' + title.slice(0, 50) + ')');
            } catch (insErr) {
              log.warn('[youtube] auto-import failed for ' + v.videoId + ':', insErr.message);
            }
          }

          updateJob('running', 2 + Math.floor((videoCount / Math.max(1, recentVideos.length)) * 1),
            'Videos gecachedt: ' + videoCount + '/' + recentVideos.length);
        } catch (e) {
          log.warn('[youtube] video ' + v.videoId + ' failed:', e.message);
        }
      }
    } catch (e) {
      log.warn('[youtube] getMyRecentVideos failed (OAuth may not be set up):', e.message);
    }

    updateJob('running', 3, 'Lade Analytics (28d)...');
    if (signal.aborted) throw new Error('aborted');
    try {
      const analytics = await youtubeApi.getMyAnalytics({ days: 28,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained' });
      const headers = analytics.columnHeaders || [];
      const row = (analytics.rows && analytics.rows[0]) || [];
      const flat = {};
      headers.forEach((h, i) => { flat[h.name] = row[i]; });
      // Normalize YouTube Analytics naming to Contentix field names
      if ('estimatedMinutesWatched' in flat) {
        flat.minutes = flat.estimatedMinutesWatched;
      }
      saveCachedYouTubeAnalytics(channelId, flat);
    } catch (e) {
      log.warn('[youtube] analytics failed (OAuth may not be set up):', e.message);
    }

    updateJob('running', 4, 'Aktualisiere Video-Daten...');
    const allVideos = getAll("SELECT id, video_id FROM videos WHERE video_id IS NOT NULL AND video_id != '' AND status != 'archived' AND is_locked = 1");
    let updated = 0;
    for (const v of allVideos) {
      if (signal.aborted) throw new Error('aborted');
      const cached = getCachedYouTubeVideo(v.video_id);
      if (cached && cached.publishedAt) {
        run('UPDATE videos SET published_date = COALESCE(?, published_date) WHERE id = ? AND published_date IS NULL',
            cached.publishedAt, v.id);
        updated++;
      }
    }

    updateJob('done', 4, 'Fertig.', {
      channel: channelStats,
      videosCached: videoCount,
      videosUpdated: updated,
      videosImported,
    });
  } catch (e) {
    if (e.message === 'aborted') {
      updateJob('cancelled', 0, 'Abgebrochen.');
    } else {
      updateJob('failed', 0, null, null, e.message);
      log.error('[youtube] refresh failed:', e.message);
    }
  }
}

// --- vidIQ watchtime block follows below

// (vidIQ watchtime helpers removed in Phase 2 refactor — use /api/youtube/analytics instead)

// GET /api/vidiq/video/:videoId → title + thumbnail_url (cached)

// ─── vidIQ Background Refresh ─────────────────────────────────────────────────

const TOTAL_REFRESH_STEPS = 6; // init + stats + balance + long + short + watchtime

// ─── Routes: vidIQ ─────────────────────────────────────────────────────────────




// ─── Version ──────────────────────────────────────────────────────────────────

function getVersion() {
  try {
    return fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();
  } catch {
    return require('./package.json').version;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: getVersion(), time: new Date().toISOString() });
});

// ─── History (HIST v1.0) ────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  try {
    const videos = getAll(
      `SELECT v.*, p.title AS parent_title
       FROM videos v
       LEFT JOIN videos p ON v.parent_video_id = p.id
       WHERE v.status = 'published'
       ORDER BY v.published_date DESC, v.created_at DESC`
    );
    const parsed = videos.map(v => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      parent_title: v.parent_title || null
    }));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/videos/:id/archive', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    run(
      "UPDATE videos SET status = 'archived', updated_at = ? WHERE id = ?",
      new Date().toISOString(), id
    );
    saveDB();
    res.json({ ok: true, id, status: 'archived' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/videos/:id/restore', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    // Restore to 'done' (default for restored videos), unless caller specifies
    const newStatus = req.body && req.body.status ? req.body.status : 'done';
    run(
      'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?',
      newStatus, new Date().toISOString(), id
    );
    saveDB();
    res.json({ ok: true, id, status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scripts/:id/restore', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM scripts WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Script nicht gefunden' }); return; }
    const newStatus = req.body && req.body.status ? req.body.status : 'draft';
    run(
      'UPDATE scripts SET status = ?, updated_at = ? WHERE id = ?',
      newStatus, new Date().toISOString(), id
    );
    saveDB();
    res.json({ ok: true, id, status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Link script to video ────────────────────────────────────────────────────
app.patch('/api/scripts/:id/link', (req, res) => {
  try {
    const { id } = req.params;
    const { video_id } = req.body;
    if (video_id !== null) {
      const video = get('SELECT id FROM videos WHERE id = ?', video_id);
      if (!video) { res.status(404).json({ error: 'Video not found' }); return; }
    }
    run('UPDATE scripts SET video_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', video_id, id);
    const script = get('SELECT * FROM scripts WHERE id = ?', id);
    res.json({ ...script, tags: script.tags ? JSON.parse(script.tags) : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Research Jobs (Vidi/Nix-Spawn, v0.10 2026-06-11) ────────────────────────────────

// POST /api/research/:videoId
// Triggert einen OpenClaw-Agent (Default: youtubebot=Vidi) als Research-Job.
// Body: { agent?: string, brief?: string }
// Antwortet sofort mit { jobId, status:'pending' }.
// Vidi-Job läuft asynchron im Hintergrund, Status-Polling via /api/research/:jobId.
app.post('/api/research/:videoId', (req, res) => {
  try {
    const video = get('SELECT * FROM videos WHERE id = ?', req.params.videoId);
    if (!video) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }

    // Cooldown: wenn für dieses Video schon ein Job läuft, kein neuer.
    const existing = get(
      `SELECT job_id, status FROM research_jobs
       WHERE video_id = ? AND status IN ('pending','running')
       ORDER BY started_at DESC LIMIT 1`,
      req.params.videoId
    );
    if (existing) {
      return res.status(409).json({
        error: 'Research-Job läuft bereits für dieses Video',
        jobId: existing.job_id,
        status: existing.status
      });
    }

    const { agent = 'youtubebot', brief = '' } = req.body || {};
    const jobId = require('crypto').randomUUID();

    run(
      `INSERT INTO research_jobs (job_id, video_id, agent_id, status, progress_message)
       VALUES (?, ?, ?, 'pending', 'Job queued')`,
      jobId, req.params.videoId, agent
    );

    const finalBrief = brief.trim() || buildVidiBrief(video);

    setImmediate(() => runResearchJob(jobId, agent, finalBrief));

    res.json({ jobId, status: 'pending', videoId: req.params.videoId, agent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/research/:jobId
// Bricht einen laufenden Vidi-Job ab. Setzt Status auf 'cancelled'.
// Hinweis: Der OpenClaw-Spawn selbst kann nicht direkt terminiert werden (kein PID-Tracking),
// aber der Status-Flag verhindert, dass der Frontend-Poll weiter wartet.
app.delete('/api/research/:jobId', (req, res) => {
  try {
    const job = get('SELECT * FROM research_jobs WHERE job_id = ?', req.params.jobId);
    if (!job) { res.status(404).json({ error: 'Job nicht gefunden' }); return; }
    if (job.status !== 'pending' && job.status !== 'running') {
      return res.status(409).json({ error: `Job ist bereits ${job.status}`, job });
    }
    run(
      `UPDATE research_jobs SET status = 'cancelled', progress_message = 'Vom User abgebrochen', finished_at = datetime('now') WHERE job_id = ?`,
      req.params.jobId
    );
    res.json({ status: 'cancelled', jobId: req.params.jobId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/research/:jobId
// Polling-Endpoint für Frontend.
app.get('/api/research/:jobId', (req, res) => {
  try {
    const job = get('SELECT * FROM research_jobs WHERE job_id = ?', req.params.jobId);
    if (!job) { res.status(404).json({ error: 'Job nicht gefunden' }); return; }
    res.json({
      jobId: job.job_id,
      videoId: job.video_id,
      agentId: job.agent_id,
      status: job.status,
      progressMessage: job.progress_message,
      error: job.error,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      result: job.result ? JSON.parse(job.result) : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/research?videoId=...&status=...
// Liste Research-Jobs.
app.get('/api/research', (req, res) => {
  try {
    const { videoId, status, limit = 20 } = req.query;
    let sql = 'SELECT * FROM research_jobs WHERE 1=1';
    const params = [];
    if (videoId) { sql += ' AND video_id = ?'; params.push(videoId); }
    if (status)  { sql += ' AND status = ?';   params.push(status); }
    sql += ' ORDER BY started_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 20);
    const rows = getAll(sql, ...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: baut Default-Brief aus Video-Daten — status-aware
function buildVidiBrief(video) {
  const statusHints = {
    planned:   'Status ist **planned** (nur Idee, noch keine Recherche). Du bist die ERSTE Recherche dazu.',
    research:  'Status ist **research** (Recherche-Phase läuft). Vielleicht existieren schon Vidi-Reports zu ähnlichen Themen — check via vidiq_channel_videos und vidiq_outliers.',
    script:    'Status ist **script** (Skript-Phase). User will ggf. Skript-V2 oder neue Hooks. Skript liegt schon in Contentix.',
    recording: 'Status ist **recording** (wird aufgenommen). Wahrscheinlich Revisions-Wunsch zu Skript oder Thumbnail.',
    done:      'Status ist **done** (fertig geschnitten). Wahrscheinlich Post-Production-Themen (Thumbnail, Titel-Optimierung).',
    published: 'Status ist **published** (live). Wahrscheinlich Follow-up-Idee oder Performance-Analyse.'
  };

  const lines = [
    `## Recherche-Auftrag: ${video.title}`,
    '',
    `**Contentix-Video-ID:** ${video.id}`,
    `**Status:** ${video.status}`,
    video.planned_date ? `**Geplant:** ${video.planned_date}` : null,
    `**Format:** ${video.video_format || 'longform'}`,
    '',
    statusHints[video.status] || `Status ist **${video.status}** (unbekannt — sei vorsichtig).`,
    '',
    '## Briefing',
    video.notes || video.description || '(kein Briefing hinterlegt)',
    '',
    '## Deine Aufgabe',
    '1. vidIQ-Recherche: Outliers, Keywords, Comments der letzten Dirk-Linux-Gaming-Videos, Reverse-Check auf Doppel-Themen.',
    '2. Skript-Entwurf V1 erstellen (~1200-1500 Wörter, deutsch, locker, "Ich zeig dir…" Tonalität).',
    '3. Konkrete Terminal-Befehle mitliefern, echte Spiele als Beispiele.',
    '4. 3 Hook-Varianten + Empfehlung, 3 Titel-Varianten, 2 Thumbnail-Ideen.',
    '5. Skript via Contentix-API pushen: POST /api/scripts mit video_id-Verlinkung.',
    '6. Video-Status NICHT automatisch ändern — wartet auf Dirks Bestätigung.',
    '',
    '## Push-Format (dein letzter Block)',
    'Schreibe einen klaren Report: TEIL A (Recherche-Zusammenfassung), TEIL B (Skript), TEIL C (Push-Bestätigung), TEIL D (offene Fragen).',
  ].filter(Boolean);
  return lines.join('\n');
}

// Asynchroner OpenClaw-Spawn mit Sub-Progress-Tracking.
// Updated research_jobs.progress_message in-place, während Vidi läuft.
function runResearchJob(jobId, agentId, brief) {
  run('UPDATE research_jobs SET status = ?, progress_message = ? WHERE job_id = ?',
      'running', '⏳ Starte Recherche…', jobId);
  saveDB();

  const { spawn } = require('child_process');
  // Expliziter Pfad — systemd-Service-User 'dirk' hat openclaw nicht im PATH
  const OPENCLAW_BIN = '/home/dirk/.npm-global/bin/openclaw';
  const cwd = '/home/dirk';

  // --verbose on lässt OpenClaw Tool-Calls nach stderr loggen. Wir parsen die,
  // um Phasen-Updates abzuleiten. Ohne Verbose fallen wir auf elapsed-time zurück.
  const args = ['agent', '--agent', agentId, '--message', brief, '--json', '--verbose', 'on'];
  log.info(`[research] Job ${jobId}: spawning ${agentId} (${brief.length} chars)`);

  const proc = spawn(OPENCLAW_BIN, args, { cwd, env: process.env });
  let stdout = '';
  let stderr = '';
  let lastProgressUpdate = Date.now();
  const startTime = Date.now();
  let currentPhase = 'Starte Recherche…';
  const phases = []; // History für finalen Status

  // Phasen-Mapping aus verbose-stderr-Output (Tool-Calls → User-Language-Phases)
  // OpenClaw loggt typischerweise "→ tool: <name>" oder "calling <tool>".
  const toolToPhase = {
    'vidiq_keyword_research': '🔍 Recherche Keywords…',
    'vidiq_outliers': '🔥 Suche Outlier-Videos…',
    'vidiq_channel_videos': '📺 Lade Channel-Daten…',
    'vidiq_video_comments': '💬 Analysiere Comments…',
    'vidiq_channel_analytics': '📊 Channel-Analytics…',
    'vidiq_score_title': '✍️ Bewerte Titel…',
    'vidiq_generate_titles': '✍️ Generiere Titel-Varianten…',
    'vidiq_generate_thumbnail': '🖼️ Generiere Thumbnail-Ideen…',
    'web_search': '🌐 Web-Recherche…',
    'memory_search': '🧠 Memory-Lookup…',
    'memory_get': '🧠 Lade Memory…',
    'read': '📖 Lese Datei…',
    'write': '✏️ Schreibe Skript…',
    'curl': '🌐 HTTP-Request…'
  };

  // Generisches Phase-Update mit elapsed-time fallback
  function updateProgress(phase) {
    if (phase === currentPhase) return;
    if (phase && !phases.includes(phase)) phases.push(phase);
    currentPhase = phase;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const phaseNote = phases.length > 0 ? ` · ${phases.length} Schritt${phases.length===1?'':'e'}` : '';
    const msg = `${phase} (${elapsed}s${phaseNote})`;
    run('UPDATE research_jobs SET progress_message = ? WHERE job_id = ?', [msg, jobId]);
    saveDB();
    lastProgressUpdate = Date.now();
    log.info(`[research] Job ${jobId}: ${msg}`);
  }

  // Parse Tool-Calls aus stderr (verbose mode)
  let stderrBuf = '';
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    stderrBuf += text;
    // Look for tool-call patterns: "→ tool:name", "calling tool:name", "tool: <name>"
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop() || ''; // keep incomplete line
    for (const line of lines) {
      // Match patterns like "→ vidiq_keyword_research" or "calling vidiq_outliers"
      const m = line.match(/(?:→|calling|tool[: ]+|->)\s*([a-z_][a-z0-9_]+)/i);
      if (m) {
        const tool = m[1].toLowerCase();
        if (toolToPhase[tool]) {
          updateProgress(toolToPhase[tool]);
        }
      }
    }
  });

  // Elapsed-time fallback: alle 20s ein generisches Update, falls keine Tool-Events
  const fallbackTimer = setInterval(() => {
    if (Date.now() - lastProgressUpdate > 20000) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed < 30) updateProgress('🔍 Recherche läuft…');
      else if (elapsed < 90) updateProgress('📊 Daten werden analysiert…');
      else if (elapsed < 180) updateProgress('✍️ Skript wird vorbereitet…');
      else updateProgress('🔬 Aufwändige Recherche, gleich fertig…');
    }
  }, 20000);

  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  proc.on('close', (code, signal) => {
    clearInterval(fallbackTimer);

    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      run('UPDATE research_jobs SET status=?, error=?, finished_at=datetime("now") WHERE job_id=?',
          'cancelled', `Abgebrochen (${signal})`, jobId);
      saveDB();
      return;
    }

    if (code !== 0) {
      log.error(`[research] Job ${jobId} failed: code=${code}, stderr=${stderr.slice(-500)}`);
      run('UPDATE research_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?',
          'error', (stderr || `exit code ${code}`).slice(0, 2000), jobId);
      saveDB();
      return;
    }
    try {
      const parsed = JSON.parse(stdout);
      const summary = parsed.summary || parsed.status || 'completed';
      const text = parsed.result?.payloads?.[0]?.text || parsed.result?.text || '';
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const finalMsg = `✅ Fertig in ${elapsed}s · ${phases.length} Schritte`;
      run('UPDATE research_jobs SET status = ?, progress_message = ?, result = ?, finished_at = datetime("now") WHERE job_id = ?',
          'done', finalMsg, JSON.stringify({ summary, text, raw: parsed, phases, elapsedSec: elapsed }), jobId);
      saveDB();
      log.info(`[research] Job ${jobId} completed (${summary}, ${elapsed}s, ${phases.length} phases)`);
    } catch (parseErr) {
      log.error(`[research] Job ${jobId} parse error:`, parseErr.message);
      run('UPDATE research_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?',
          'error', 'Failed to parse OpenClaw output: ' + (parseErr.message || '').slice(0, 1000), jobId);
      saveDB();
    }
  });

  proc.on('error', (err) => {
    clearInterval(fallbackTimer);
    log.error(`[research] Job ${jobId} spawn error:`, err.message);
    run('UPDATE research_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?',
        'error', (err.message || 'spawn failed').slice(0, 2000), jobId);
    saveDB();
  });
}

// Shell-escape (single-quoted, escapes embedded single quotes)
function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// ─── Logs API ──────────────────────────────────────────────────────────────────
// GET /api/logs?lines=200&level=INFO|WARN|ERROR&search=foo
//   lines  — how many tail lines to return (default 200, max 2000)
//   level  — only return lines with this level or higher (INFO|WARN|ERROR)
//   search — optional substring filter (case-insensitive)
// Reads from data/contentix.log (current) + .1/.2/.3 generations if present.
app.get('/api/logs', (req, res) => {
  try {
    const lines = Math.min(parseInt(req.query.lines, 10) || 200, 2000);
    const level = (req.query.level || '').toUpperCase();
    const search = (req.query.search || '').toString();
    const levelRanks = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    const minRank = levelRanks[level] != null ? levelRanks[level] : 0;

    // Read from current log + rotated generations, oldest first
    const files = [LOG_FILE];
    for (let i = 1; i <= LOG_KEEP_GENERATIONS; i++) {
      const p = `${LOG_FILE}.${i}`;
      if (fs.existsSync(p)) files.push(p);
    }
    let combined = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(f, 'utf-8');
        combined = combined.concat(content.split('\n').filter(Boolean));
      } catch (_) { /* file unreadable — skip */ }
    }

    // Filter by level + search, then take tail
    const filtered = combined.filter((line) => {
      const m = line.match(/^\[[^\]]+\]\s+\[(\w+)\]/);
      const lvl = m ? m[1] : 'INFO';
      if (levelRanks[lvl] == null || levelRanks[lvl] < minRank) return false;
      if (search && !line.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const tail = filtered.slice(-lines);

    res.json({
      ok: true,
      totalLines: combined.length,
      returnedLines: tail.length,
      logFile: LOG_FILE,
      bytes: (() => { try { return fs.statSync(LOG_FILE).size; } catch (_) { return 0; } })(),
      lines: tail,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

initDB().then(() => {
  // Load persisted YouTube cache settings now that the DB is ready.
  // (Previously this ran at module-load time and always failed with
  // "Cannot read properties of undefined (reading 'prepare')" because
  // `db` was assigned later in initDB().then().)
  try {
    const settingsRows = getAll("SELECT key, value FROM app_settings WHERE key LIKE 'yt.%'");
    for (const r of settingsRows) {
      const key = r.key.replace('yt.', '');
      if (key in YT_CACHE_SETTINGS) {
        const num = Number(r.value);
        if (Number.isFinite(num)) YT_CACHE_SETTINGS[key] = num;
      }
    }
    log.info('Loaded YouTube cache settings:', YT_CACHE_SETTINGS);
  } catch (e) {
    log.warn('Could not load YouTube cache settings:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    log.info(`Contentix v${getVersion()} running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  log.error('Failed to init DB:', err);
  process.exit(1);
});
