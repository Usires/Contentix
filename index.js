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

app.get('/api/scripts/folders', (req, res) => {
  try {
    const rows = getAll('SELECT DISTINCT folder FROM scripts ORDER BY folder ASC');
    res.json(rows.map(r => r.folder));
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

// ─── Start ────────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Contentix v${getVersion()} running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
