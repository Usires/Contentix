const express = require('express');
const initSqlJs = require('sql.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// vidIQ API key check
if (!process.env.VIDIQ_API_KEY) {
  console.error('FATAL: VIDIQ_API_KEY environment variable not set');
  process.exit(1);
}
const VIDIQ_API_KEY = process.env.VIDIQ_API_KEY;
const PORT = 3038;
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
const DB_PATH = path.join(__dirname, 'contentix.db');

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
      try { db.run("ALTER TABLE videos ADD COLUMN owner TEXT DEFAULT 'dirk'"); console.log('Migration: added owner column to videos'); } catch(e) { console.error('Migration videos.owner failed:', e.message); }
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS vidiq_cache (
        channel_id TEXT PRIMARY KEY,
        data TEXT,
        fetched_at TEXT
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS vidiq_video_cache (
        video_id TEXT PRIMARY KEY,
        data TEXT,
        fetched_at TEXT
      );
    `);
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
    db.run(`
      CREATE TABLE IF NOT EXISTS vidiq_refresh_jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        total INTEGER DEFAULT 6,
        result TEXT,
        error TEXT,
        started_at TEXT DEFAULT (datetime('now')),
        finished_at TEXT
      );
    `);
    saveDB();
  }
  // Migration: ensure vidiq_refresh_jobs exists for existing DBs
  db.run(`CREATE TABLE IF NOT EXISTS vidiq_refresh_jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    total INTEGER DEFAULT 6,
    result TEXT,
    error TEXT,
    started_at TEXT,
    finished_at TEXT
  )`);
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

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── vidIQ Utilities (extracted from route handlers) ──────────────────────────

function makeVidiqCmd(apiKey) {
  return function vidIqCmd(id, name, args) {
    const payload = JSON.stringify({jsonrpc:"2.0", id, method:"tools/call", params:{name, arguments:args}});
    return `curl -s -X POST "https://mcp.vidiq.com/mcp" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${payload}'`;
  };
}

const vidIqCmd = makeVidiqCmd(VIDIQ_API_KEY);

function parseVidiqResponse(output) {
  const match = output.match(/\[\{"type":"text","text":"([\s\S]+)"\}\]/);
  if (!match) {
    console.error('parseVidiq: No match. First 80:', output.slice(0, 80));
    return null;
  }
  try {
    const raw = match[1];
    let decoded = '';
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\\' && i < raw.length - 1) {
        const next = raw[i + 1];
        if (next === 'n') { decoded += '\n'; i++; }
        else if (next === '"') { decoded += '"'; i++; }
        else if (next === '\\') { decoded += '\\'; i++; }
        else if (next === 't') { decoded += '\t'; i++; }
        else { decoded += raw[i]; }
      } else {
        decoded += raw[i];
      }
    }
    let parseable = decoded;
    while (parseable.length > 0) {
      try { return JSON.parse(parseable); } catch (_) { parseable = parseable.slice(0, -1); }
    }
    return null;
  } catch(e) { console.error('Parse error:', e.message); return null; }
}

function autoMatchVidiq(cardId, youtubeUrl, needsTitle, needsThumb) {
  const vidMatch = youtubeUrl.match(/(?:v=|\/youtu\.be\/)([^&\s?]+)/);
  if (!vidMatch) return;
  const vid = vidMatch[1];
  try {
    const cachedRow = getAll('SELECT * FROM vidiq_video_cache WHERE video_id = ?', vid);
    let vidiqData = null;
    if (cachedRow.length > 0) {
      const ageMs = (Date.now() - new Date(cachedRow[0].fetched_at).getTime()) / 1000 / 60;
      if (ageMs < 1440) vidiqData = JSON.parse(cachedRow[0].data);
    }
    if (!vidiqData) {
      const output = execSync(vidIqCmd(99, 'vidiq_get_videos_by_ids', { videoIds: [vid] }), { encoding: 'utf8', timeout: 15000 });
      vidiqData = parseVidiqResponse(output);
      if (Array.isArray(vidiqData)) vidiqData = vidiqData[0];
      if (vidiqData && vidiqData.videos) vidiqData = vidiqData.videos[0];
      if (vidiqData) run('INSERT OR REPLACE INTO vidiq_video_cache (video_id, data, fetched_at) VALUES (?, ?, datetime("now"))', vid, JSON.stringify(vidiqData));
    }
    if (vidiqData) {
      const upds = []; const p = [];
      if (needsTitle && vidiqData.title) { upds.push('title = ?'); p.push(vidiqData.title); }
      if (needsThumb && (vidiqData.thumbnail || vidiqData.thumbnailUrl)) { upds.push('thumbnail_url = ?'); p.push(vidiqData.thumbnail || vidiqData.thumbnailUrl); }
      if (upds.length > 0) { p.push(cardId); run(`UPDATE videos SET ${upds.join(', ')} WHERE id = ?`, ...p); saveDB(); }
    }
  } catch(vqErr) { console.error('Auto-match vidIQ error:', vqErr.message); }
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
    res.json({ id, status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/scripts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, folder, status, content, video_id, video_format, tags, position } = req.body;
    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (slug !== undefined) { updates.push('slug = ?'); params.push(slug); }
    if (folder !== undefined) { updates.push('folder = ?'); params.push(folder); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (video_id !== undefined) { updates.push('video_id = ?'); params.push(video_id); }
    if (video_format !== undefined) { updates.push('video_format = ?'); params.push(video_format); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (position !== undefined) { updates.push('position = ?'); params.push(position); }
    updates.push('updated_at = ?'); params.push(new Date().toISOString());
    params.push(id);
    run(`UPDATE scripts SET ${updates.join(', ')} WHERE id = ?`, ...params);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/scripts/:id', (req, res) => {
  try {
    run('DELETE FROM scripts WHERE id = ?', req.params.id);
    res.json({ status: 'ok' });
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
      
      // Try to get vidIQ stats
      if (v.video_id) {
        try {
          const cached = getAll('SELECT * FROM vidiq_video_cache WHERE video_id = ?', v.video_id);
          let vidiqData = null;
          if (cached.length > 0) {
            const ageMs = (Date.now() - new Date(cached[0].fetched_at).getTime()) / 1000 / 60;
            if (ageMs < 1440) vidiqData = JSON.parse(cached[0].data);
          }
          if (vidiqData) {
            parsed.views = vidiqData.viewCount || 0;
            parsed.likes = vidiqData.likeCount || 0;
            parsed.publishedAt = vidiqData.publishedAt || null;
            parsed.duration = vidiqData.duration || null;
            parsed.commentCount = vidiqData.commentCount || 0;
          } else {
            parsed.views = 0;
            parsed.likes = 0;
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

app.put('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!existing) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    const { title, status, video_format, thumbnail_url, planned_date, published_date, video_id, youtube_url, tags, notes, nix_comment, nix_comment_source, owner, position, script_id } = req.body;
    
    const updates = [];
    const params = [];
    
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (video_format !== undefined) { updates.push('video_format = ?'); params.push(video_format); }
    if (thumbnail_url !== undefined) { updates.push('thumbnail_url = ?'); params.push(thumbnail_url); }
    if (planned_date !== undefined) { updates.push('planned_date = ?'); params.push(planned_date); }
    if (published_date !== undefined) { updates.push('published_date = ?'); params.push(published_date); }
    if (video_id !== undefined) { updates.push('video_id = ?'); params.push(video_id); }
    if (youtube_url !== undefined) { updates.push('youtube_url = ?'); params.push(youtube_url); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (nix_comment !== undefined) { updates.push('nix_comment = ?'); params.push(nix_comment); }
    if (nix_comment_source !== undefined) { updates.push("nix_comment_source = ?"); params.push(nix_comment_source); }
    if (owner !== undefined) { updates.push("owner = ?"); params.push(owner); }
    if (script_id !== undefined) { updates.push('script_id = ?'); params.push(script_id); }
    if (position !== undefined) { updates.push('position = ?'); params.push(position); }
    
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    
    run(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`, ...params);
    saveDB();
    
    // Feature 2: Auto-match when published + youtube_url present
    if (status === 'published' && youtube_url) {
      const card = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
      const needsTitle = !card.title || card.title.trim() === '';
      const needsThumb = !card.thumbnail_url || card.thumbnail_url.trim() === '';
      if (needsTitle || needsThumb) autoMatchVidiq(id, youtube_url, needsTitle, needsThumb);
    }
    
    const video = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    const parsed = { ...video, tags: video.tags ? JSON.parse(video.tags) : [] };
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
    const { title, status, video_format, thumbnail_url, planned_date, published_date, video_id, youtube_url, tags, notes, nix_comment, nix_comment_source, owner, position, script_id } = req.body;
    
    const updates = [];
    const params = [];
    
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (video_format !== undefined) { updates.push('video_format = ?'); params.push(video_format); }
    if (thumbnail_url !== undefined) { updates.push('thumbnail_url = ?'); params.push(thumbnail_url); }
    if (planned_date !== undefined) { updates.push('planned_date = ?'); params.push(planned_date); }
    if (published_date !== undefined) { updates.push('published_date = ?'); params.push(published_date); }
    if (video_id !== undefined) { updates.push('video_id = ?'); params.push(video_id); }
    if (youtube_url !== undefined) { updates.push('youtube_url = ?'); params.push(youtube_url); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (nix_comment !== undefined) { updates.push('nix_comment = ?'); params.push(nix_comment); }
    if (nix_comment_source !== undefined) { updates.push("nix_comment_source = ?"); params.push(nix_comment_source); }
    if (owner !== undefined) { updates.push("owner = ?"); params.push(owner); }
    if (script_id !== undefined) { updates.push('script_id = ?'); params.push(script_id); }
    if (position !== undefined) { updates.push('position = ?'); params.push(position); }
    
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    
    run(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`, ...params);
    saveDB();
    
    const video = getAll('SELECT * FROM videos WHERE id = ?', id)[0];
    if (!video) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }
    const parsed = { ...video, tags: video.tags ? JSON.parse(video.tags) : [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    run('DELETE FROM videos WHERE id = ?', id);
    saveDB();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: vidIQ ─────────────────────────────────────────────────────────────

app.get('/api/vidiq/stats', (req, res) => {
  try {
    const rows = getAll('SELECT * FROM vidiq_cache WHERE channel_id = ?', 'UC-YmLEIgdESaoVN3ZKNT_QA');
    if (rows.length > 0) {
      const data = JSON.parse(rows[0].data);
      const age = rows[0].fetched_at;
      const ageMs = (Date.now() - new Date(age).getTime()) / 1000 / 60;
      res.json({ ...data, cached: true, age: `${Math.round(ageMs)} minutes ago`, fresh: ageMs < 60 });
    } else {
      res.json({ stats: {}, balance: {}, channelId: 'UC-YmLEIgdESaoVN3ZKNT_QA', cached: false });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vidiq/channel-stats → subs, views, watchtimeHours, videoCount + latest video
app.get('/api/vidiq/channel-stats', (req, res) => {
  try {
    const rows = getAll('SELECT * FROM vidiq_cache WHERE channel_id = ?', 'UC-YmLEIgdESaoVN3ZKNT_QA');
    if (rows.length === 0) {
      res.json({ subs: 0, views: 0, watchtimeHours: 0, videoCount: 0, latestVideo: null, cached: false });
      return;
    }
    const data = JSON.parse(rows[0].data);
    const s = data.stats?.currentStats || data.stats || {};
    const fetchedAt = rows[0].fetched_at; // ISO timestamp from DB
    res.json({
      subs: s.subscribers || 0,
      views: s.views || 0,
      watchtimeHours: s.watchtimeHours || 0,  // nicht direkt von vidIQ geliefert
      videoCount: s.videos || 0,
      latestVideo: data.latestVideo || null,
      cached: true,
      _fetched_at: fetchedAt || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vidiq/video/:videoId → title + thumbnail_url (cached)
app.get('/api/vidiq/video/:videoId', async (req, res) => {
  const { videoId } = req.params;
  const { video_id } = req.query;
  // Allow videoId as query param for proxy use
  const vid = video_id || videoId;
  if (!vid) { res.status(400).json({ error: 'videoId required' }); return; }

  try {
    // Check cache first
    const cached = getAll('SELECT * FROM vidiq_video_cache WHERE video_id = ?', vid);
    if (cached.length > 0) {
      const ageMs = (Date.now() - new Date(cached[0].fetched_at).getTime()) / 1000 / 60;
      if (ageMs < 1440) { // cache max 24h
        res.json({ ...JSON.parse(cached[0].data), cached: true, age: `${Math.round(ageMs)} minutes ago` });
        return;
      }
    }

    // Fetch from vidIQ MCP
    const output = execSync(vidIqCmd(1, 'vidiq_get_videos_by_ids', { videoIds: [vid] }), { encoding: 'utf8', timeout: 15000 });
    let cleanData = parseVidiqResponse(output);
    if (!cleanData) { res.status(404).json({ error: 'Keine Daten von vidIQ' }); return; }
    const videoData = cleanData.videos && cleanData.videos[0] ? cleanData.videos[0] : (Array.isArray(cleanData) ? cleanData[0] : cleanData);
    if (!videoData || !videoData.title) { res.status(404).json({ error: 'Video nicht gefunden' }); return; }

    const result = {
      title: videoData.title || '',
      thumbnail_url: videoData.thumbnail || videoData.thumbnailUrl || '',
      videoId: vid
    };

    // Cache it
    run('INSERT OR REPLACE INTO vidiq_video_cache (video_id, data, fetched_at) VALUES (?, ?, datetime("now"))', vid, JSON.stringify(result));
    saveDB();
    res.json({ ...result, cached: false });
  } catch (error) {
    console.error('vidIQ video fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── vidIQ Background Refresh ─────────────────────────────────────────────────

const TOTAL_REFRESH_STEPS = 5; // init + stats + balance + long + short (per-video is dynamic)

async function runVidiqRefresh(jobId) {
  console.log('[vidIQ] runVidiqRefresh gestartet, jobId:', jobId);
  const CHANNEL_ID = 'UC-YmLEIgdESaoVN3ZKNT_QA';

  function updateProgress(step) {
    run('UPDATE vidiq_refresh_jobs SET progress = ? WHERE job_id = ?', step, jobId);
    saveDB();
  }

  try {
    // Step 1: Initialize
    execSync(vidIqCmd(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'contentix', version: '1.0' } }), { encoding: 'utf8', timeout: 10000 });
    updateProgress(1);

    // Step 2: Stats
    const statsOutput = execSync(vidIqCmd(2, 'vidiq_channel_stats', { channelId: CHANNEL_ID }), { encoding: 'utf8', timeout: 15000 });
    updateProgress(2);

    // Step 3: Balance
    const balanceOutput = execSync(vidIqCmd(3, 'vidiq_balance', {}), { encoding: 'utf8', timeout: 15000 });
    updateProgress(3);

    // Step 4: Long videos
    const longOutput = execSync(vidIqCmd(4, 'vidiq_channel_videos', { channelId: CHANNEL_ID, videoFormat: 'long', popular: false }), { encoding: 'utf8', timeout: 15000 });
    updateProgress(4);

    // Step 5: Short videos
    const shortOutput = execSync(vidIqCmd(5, 'vidiq_channel_videos', { channelId: CHANNEL_ID, videoFormat: 'short', popular: false }), { encoding: 'utf8', timeout: 15000 });
    updateProgress(5);

    let stats = {};
    let balance = {};

    const statsParsed = parseVidiqResponse(statsOutput);
    if (statsParsed) stats = statsParsed;
    const balanceParsed = parseVidiqResponse(balanceOutput);
    if (balanceParsed) balance = balanceParsed;

    let videosImported = 0;
    for (const fmt of ['long', 'short']) {
      const output = fmt === 'long' ? longOutput : shortOutput;
      const parsed = parseVidiqResponse(output);
      if (parsed && parsed.videos) {
        for (const v of parsed.videos) {
          try {
            const existing = getAll('SELECT id FROM videos WHERE video_id = ?', v.videoId);
            const publishedAt = v.publishedAt ? new Date(v.publishedAt).toISOString() : null;
            const videoFormat = fmt === 'short' ? 'shorts' : 'longform';
            if (existing.length === 0) {
              const id = require('crypto').randomUUID();
              const now = new Date().toISOString();
              run(`INSERT INTO videos (id, title, status, video_format, planned_date, published_date, video_id, youtube_url, tags, thumbnail_url, created_at, updated_at) VALUES (?, ?, 'published', ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
                id, v.title, videoFormat, publishedAt, publishedAt, v.videoId, `https://youtube.com/watch?v=${v.videoId}`, v.thumbnail || '', now, now);
              videosImported++;
            }
          } catch(e) { /* skip duplicates */ }
        }
      }
    }

    // Find latest video from long videos
    let latestVideo = null;
    const longParsed = parseVidiqResponse(longOutput);
    if (longParsed && longParsed.videos && longParsed.videos.length > 0) {
      const sorted = [...longParsed.videos].sort((a, b) => {
        const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return db - da;
      });
      const lv = sorted[0];
      latestVideo = {
        title: lv.title || '',
        videoId: lv.videoId || '',
        thumbnail: lv.thumbnail || '',
        publishedAt: lv.publishedAt || null
      };
    }

    const data = { stats, balance, channelId: CHANNEL_ID, latestVideo };
    run('INSERT OR REPLACE INTO vidiq_cache (channel_id, data, fetched_at) VALUES (?, ?, datetime("now"))', CHANNEL_ID, JSON.stringify(data));
    saveDB();

    // Per-video cache: count total first, then process
    const allVideos = getAll('SELECT video_id FROM videos WHERE video_id IS NOT NULL');
    const totalVideos = allVideos.length;
    run('UPDATE vidiq_refresh_jobs SET total = ? WHERE job_id = ?', TOTAL_REFRESH_STEPS + totalVideos, jobId);
    saveDB();

    let cachedCount = 0;
    for (const { video_id: vid } of allVideos) {
      if (!vid) continue;
      const cached = getAll('SELECT fetched_at FROM vidiq_video_cache WHERE video_id = ?', vid);
      if (cached.length > 0) {
        const ageMs = (Date.now() - new Date(cached[0].fetched_at).getTime()) / 1000 / 60;
        if (ageMs < 60) { cachedCount++; continue; }
      }
      try {
        const out = execSync(vidIqCmd(99, 'vidiq_get_videos_by_ids', { videoIds: [vid] }), { encoding: 'utf8', timeout: 15000 });
        const parsed = parseVidiqResponse(out);
        if (parsed && parsed.videos && parsed.videos[0]) {
          const vd = parsed.videos[0];
          run('INSERT OR REPLACE INTO vidiq_video_cache (video_id, data, fetched_at) VALUES (?, ?, datetime("now"))', vid, JSON.stringify(vd));
        }
      } catch(e) { /* skip individual failures */ }
      cachedCount++;
      updateProgress(TOTAL_REFRESH_STEPS + cachedCount);
    }
    saveDB();

    // Done
    run('UPDATE vidiq_refresh_jobs SET status = ?, finished_at = datetime("now"), result = ? WHERE job_id = ?', 'done', JSON.stringify({ ...data, videosImported }), jobId);
    saveDB();

  } catch (error) {
    console.error('vidIQ refresh error:', error.message);
    run('UPDATE vidiq_refresh_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?', 'error', error.message, jobId);
    saveDB();
  }
}

// ─── Routes: vidIQ ─────────────────────────────────────────────────────────────

app.post('/api/vidiq/refresh', (req, res) => {
  console.log('[vidIQ] Refresh gestartet');
  const { randomUUID } = require('crypto');
  const jobId = randomUUID();
  const CHANNEL_ID = 'UC-YmLEIgdESaoVN3ZKNT_QA';

  try {
    // Create job record
    run('INSERT INTO vidiq_refresh_jobs (job_id, status, progress, total) VALUES (?, ?, 0, ?)', jobId, 'running', TOTAL_REFRESH_STEPS);
    saveDB();
    console.log('[vidIQ] Job erstellt:', jobId);

    // Respond immediately
    res.json({ jobId, status: 'running', message: 'Refresh gestartet' });
    console.log('[vidIQ] Response gesendet');

    // Run in background (fire-and-forget)
    setImmediate(() => { console.log('[vidIQ] Background Job startet'); runVidiqRefresh(jobId); });
  } catch(e) {
    console.error('[vidIQ] POST handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vidiq/refresh/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  console.log('[vidIQ] Status poll:', jobId);
  const job = get('SELECT * FROM vidiq_refresh_jobs WHERE job_id = ?', jobId);
  if (!job) { res.status(404).json({ error: 'Job nicht gefunden' }); return; }
  res.json({
    jobId: job.job_id,
    status: job.status,
    progress: job.progress,
    total: job.total,
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
    result: job.result ? JSON.parse(job.result) : null
  });
});

app.post('/api/vidiq/video-stats/:videoId', (req, res) => {
  const { videoId } = req.params;

  try {
    const output = execSync(vidIqCmd(1, 'vidiq_get_videos_by_ids', { videoIds: [videoId] }), { encoding: 'utf8', timeout: 15000 });
    const data = parseVidiqResponse(output);
    if (!data) { res.status(404).json({ error: 'No data found' }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
  console.log(`[research] Job ${jobId}: spawning ${agentId} (${brief.length} chars)`);

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
    console.log(`[research] Job ${jobId}: ${msg}`);
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
      console.error(`[research] Job ${jobId} failed: code=${code}, stderr=${stderr.slice(-500)}`);
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
      console.log(`[research] Job ${jobId} completed (${summary}, ${elapsed}s, ${phases.length} phases)`);
    } catch (parseErr) {
      console.error(`[research] Job ${jobId} parse error:`, parseErr.message);
      run('UPDATE research_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?',
          'error', 'Failed to parse OpenClaw output: ' + (parseErr.message || '').slice(0, 1000), jobId);
      saveDB();
    }
  });

  proc.on('error', (err) => {
    clearInterval(fallbackTimer);
    console.error(`[research] Job ${jobId} spawn error:`, err.message);
    run('UPDATE research_jobs SET status = ?, error = ?, finished_at = datetime("now") WHERE job_id = ?',
        'error', (err.message || 'spawn failed').slice(0, 2000), jobId);
    saveDB();
  });
}

// Shell-escape (single-quoted, escapes embedded single quotes)
function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// ─── Start ────────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Contentix v${getVersion()} running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
