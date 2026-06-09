// ─── Contentix Script Editor ───────────────────────────────────────────────
// API defined in app.js

// ─── State ─────────────────────────────────────────────────────────────────
let allScripts = [];
let activeScript = null;
let autoSaveTimer = null;
let isDirty = false;

// ─── Init ─────────────────────────────────────────────────────────────────
async function initScripts() {
  await loadVideosForLink();
  await loadScripts();
}

// ─── Load ─────────────────────────────────────────────────────────────────
async function loadScripts() {
  const container = document.getElementById('scriptsContainer');
  if (!container) return;

  try {
    const res = await fetch(`${API}/scripts`);
    if (!res.ok) throw new Error('API nicht erreichbar');
    allScripts = await res.json();
    renderScriptsView();
  } catch (err) {
    container.innerHTML = `<div class="scripts-empty-state"><h3>Fehler</h3><p>${err.message}</p></div>`;
  }
}

async function loadVideosForLink() {
  const res = await fetch(`${API}/videos`);
  if (!res.ok) { window._allVideos = []; return []; }
  const videos = await res.json();
  window._allVideos = videos;
  return videos;
}

// ─── Render ────────────────────────────────────────────────────────────────
function renderScriptsView() {
  const container = document.getElementById('scriptsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="scripts-layout">
      <div class="scripts-list-panel">
        <div class="scripts-list-header">
          <h2>Skripte</h2>
          <button class="btn-icon" onclick="createNewScript()" title="Neues Skript" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(42,32,48,0.15);background:#7c5cbf;color:#fff;cursor:pointer;font-size:16px;">+</button>
        </div>
        <div class="scripts-list" id="scriptsList">
          ${renderScriptsList()}
        </div>
      </div>
      <div class="scripts-editor-panel" id="scriptsEditorPanel">
        ${activeScript ? renderEditor() : renderEmptyState()}
      </div>
    </div>
  `;

  setupEditorEvents();
}

function renderScriptsList() {
  if (allScripts.length === 0) {
    return `<div class="script-empty">Noch keine Skripte.<br>Erstelle dein erstes.</div>`;
  }

  return allScripts.map(s => `
    <div class="script-card ${activeScript?.id === s.id ? 'active' : ''}" onclick="selectScript('${s.id}')">
      <div class="script-card__title">${s.title || 'Unbenannt'}</div>
      <div class="script-card__meta">
        <span>${s.content ? s.content.split(/\s+/).length : 0} Wörter</span>
        ${s.folder ? `<span>📁 ${s.folder}</span>` : ''}
      </div>
      ${s.video_id ? `<div class="script-card__linked-video">🔗 ${getVideoTitle(s.video_id)}</div>` : ''}
    </div>
  `).join('');
}

function getVideoTitle(videoId) {
  // We don't have videos loaded here, so just show the ID
  return videoId ? `Video #${videoId.substring(0, 8)}…` : '';
}

function renderEmptyState() {
  return `
    <div class="scripts-empty-state">
      <h3>Kein Skript ausgewählt</h3>
      <p>Wähle ein Skript aus der Liste oder erstelle ein neues, um mit dem Schreiben zu beginnen.</p>
      <button onclick="createNewScript()">+ Neues Skript erstellen</button>
    </div>
  `;
}

function renderEditor() {
  const s = activeScript;
  return `
    <div class="scripts-editor-header">
      <input type="text" class="scripts-editor-title" id="scriptTitleInput"
        value="${escapeHtml(s.title || '')}" placeholder="Skript-Titel…"
        oninput="markDirty()">
      <div class="scripts-video-link">
        <label for="videoLinkSelect">🔗</label>
        <select id="videoLinkSelect" onchange="linkScriptToVideo(this.value)">
          <option value="">— Kein Video —</option>
          ${allVideosHtml(s.video_id)}
        </select>
      </div>
    </div>
    <div class="scripts-editor-body">
      <div class="scripts-editor-input">
        <div class="scripts-toolbar">
          <button onclick="insertMd('**', '**')" title="Bold">𝐁</button>
          <button onclick="insertMd('*', '*')" title="Italic">𝐼</button>
          <button onclick="insertMd('## ', '')" title="Heading 2">H2</button>
          <button onclick="insertMd('### ', '')" title="Heading 3">H3</button>
          <div class="sep"></div>
          <button onclick="insertMd('[', '](url)')" title="Link">🔗</button>
          <button onclick="insertMd('- ', '')" title="List">•</button>
          <button onclick="insertMd('> ', '')" title="Quote">"</button>
          <div class="sep"></div>
          <button onclick="insertCode()" title="Code">&lt;/&gt;</button>
        </div>
        <textarea class="scripts-textarea" id="scriptTextarea"
          placeholder="Schreibe dein Skript in Markdown…"
          oninput="onTextInput()">${escapeHtml(s.content || '')}</textarea>
      </div>
      <div class="scripts-preview" id="scriptPreview">
        ${renderPreview(s.content || '')}
      </div>
    </div>
    <div class="scripts-editor-footer">
      <div class="script-stats">
        <span class="script-stats-item" id="wordCountStat">${countWords(s.content)} Wörter</span>
        <span class="script-stats-item" id="charCountStat">${s.content ? s.content.length : 0} Zeichen</span>
        <span class="script-stats-item" id="saveStatus">${isDirty ? '⚠ ungespeichert' : '✓ gespeichert'}</span>
      </div>
      <div class="scripts-editor-actions">
        <button class="btn btn--secondary" onclick="printActiveScript()" title="Skript drucken / als PDF speichern">🖨️ Drucken</button>
        <button class="btn btn--secondary" onclick="archiveScript()" title="Skript archivieren (nicht löschen)">📦 Archivieren</button>
        <button class="btn btn--danger" onclick="deleteScript()" title="Skript endgültig löschen">🗑️ Löschen</button>
        <button class="btn btn--primary" onclick="saveScript()">💾 Speichern</button>
      </div>
    </div>
  `;
}

function allVideosHtml(selectedId) {
  if (!window._allVideos || window._allVideos.length === 0) {
    return '<option value="">— Videos werden geladen… —</option>';
  }
  return window._allVideos.map(v => {
    const sel = v.id === selectedId ? ' selected' : '';
    return `<option value="${v.id}"${sel}>${escapeHtml(v.title)}</option>`;
  }).join('');
}

// ─── Print ─────────────────────────────────────────────────────────────────
function printActiveScript() {
  if (!activeScript) return;
  const title = activeScript.title || 'Unbenanntes Skript';
  const body = renderPreview(activeScript.content || '');
  const linkedVideo = activeScript.video_id ? getVideoTitle(activeScript.video_id) : null;
  const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const wordCount = countWords(activeScript.content || '');

  // Build print document in a hidden iframe — avoids popup blockers (Vivaldi!)
  // and preserves the user-gesture chain for window.print() inside the iframe.
  let iframe = document.getElementById('printIframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'printIframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { background: #fff; color: #111; font-family: Georgia, 'Times New Roman', serif; margin: 0; padding: 40px 56px; }
    .print-header { border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 28px; }
    .print-header h1 { font-size: 24pt; margin: 0 0 6px 0; font-weight: 700; color: #111; }
    .print-header .meta { font-size: 10pt; color: #555; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .print-header .meta span { margin-right: 14px; }
    .print-body { font-size: 12pt; line-height: 1.65; color: #1a1520; max-width: 760px; }
    .print-body h1, .print-body h2, .print-body h3 { color: #1a1520; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .print-body h1 { font-size: 20pt; margin-top: 1.4em; }
    .print-body h2 { font-size: 16pt; margin-top: 1.2em; }
    .print-body h3 { font-size: 13pt; margin-top: 1em; }
    .print-body pre { background: #f4f0eb; padding: 12px 14px; border-radius: 4px; font-family: 'SF Mono', Consolas, monospace; font-size: 10.5pt; white-space: pre-wrap; }
    .print-body code { background: #f4f0eb; padding: 1px 5px; border-radius: 3px; font-family: 'SF Mono', Consolas, monospace; font-size: 0.92em; }
    .print-body blockquote { border-left: 3px solid #7c5cbf; margin: 1em 0; padding: 4px 14px; color: #444; font-style: italic; }
    .print-body a { color: #5b3f9e; text-decoration: underline; }
    .print-footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 9pt; color: #777; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; }
    @media print {
      body { padding: 0; }
      .print-header { page-break-after: avoid; }
      .print-body h1, .print-body h2, .print-body h3 { page-break-after: avoid; }
      .print-body pre, .print-body blockquote { page-break-inside: avoid; }
      .print-footer { page-break-before: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>📅 ${date}</span>
      <span>📝 ${wordCount} Wörter</span>
      ${linkedVideo ? `<span>🎬 ${escapeHtml(linkedVideo)}</span>` : ''}
    </div>
  </div>
  <div class="print-body">${body || '<p style="color:#999;font-style:italic;">(leeres Skript)</p>'}</div>
  <div class="print-footer">Contentix · ${escapeHtml(title)}</div>
  <script>window.onload = function() { window.focus(); window.print(); };<\/script>
</body>
</html>`);
  doc.close();
}

// ─── Markdown ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderPreview(md) {
  if (!md) return '<p style="color:#a0999f;font-style:italic;">Live-Vorschau erscheint hier…</p>';

  // Simple markdown to HTML (avoid heavy deps)
  let html = md
    // Code blocks first (before other processing)
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Blockquotes
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Editor Events ─────────────────────────────────────────────────────────
function setupEditorEvents() {
  const textarea = document.getElementById('scriptTextarea');
  if (!textarea) return;

  // Load videos for dropdown (already in window._allVideos from initScripts)
  const select = document.getElementById('videoLinkSelect');
  if (select) {
    if (window._allVideos && window._allVideos.length > 0) {
      select.innerHTML = '<option value="">— Kein Video —</option>' +
        window._allVideos.map(v => `<option value="${v.id}">${escapeHtml(v.title)}</option>`).join('');
    }
    if (activeScript?.video_id) {
      select.value = activeScript.video_id;
    }
  }
}

function onTextInput() {
  markDirty();
  updatePreview();
  updateStats();
  scheduleAutoSave();
}

function updatePreview() {
  const textarea = document.getElementById('scriptTextarea');
  const preview = document.getElementById('scriptPreview');
  if (!textarea || !preview) return;
  preview.innerHTML = renderPreview(textarea.value);
}

function updateStats() {
  const textarea = document.getElementById('scriptTextarea');
  const wc = document.getElementById('wordCountStat');
  const cc = document.getElementById('charCountStat');
  if (!textarea) return;
  const text = textarea.value;
  if (wc) wc.textContent = countWords(text) + ' Wörter';
  if (cc) cc.textContent = text.length + ' Zeichen';
}

function markDirty() {
  isDirty = true;
  const status = document.getElementById('saveStatus');
  if (status) status.textContent = '⚠ ungespeichert';
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty) saveScript(true);
  }, 30000); // 30s auto-save
}

function insertMd(before, after) {
  const textarea = document.getElementById('scriptTextarea');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);
  const replacement = before + selected + after;
  textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

// ─── CRUD ──────────────────────────────────────────────────────────────────
function insertCode() {
  const textarea = document.getElementById('scriptTextarea');
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end) || 'Code here';
  textarea.value = textarea.value.substring(0, start) + '\x60\x60\x60\n' + selected + '\n\x60\x60\x60' + textarea.value.substring(end);
  textarea.selectionStart = start + 4;
  textarea.selectionEnd = start + 4 + selected.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
}

async function selectScript(id) {
  if (isDirty && activeScript) {
    await saveScript(true);
  }
  activeScript = allScripts.find(s => s.id === id) || null;
  renderScriptsView();
}

async function createNewScript() {
  const title = 'Neues Skript';
  try {
    const res = await fetch(`${API}/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        slug: 'script-' + Date.now(),
        folder: 'scripts',
        status: 'draft',
        content: '',
        video_id: null,
        video_format: 'longform',
        tags: [],
        position: 0
      })
    });
    if (!res.ok) throw new Error('Fehler');
    const newScript = await res.json();
    allScripts.unshift(newScript);
    activeScript = newScript;
    renderScriptsView();
  } catch (err) {
    console.error(err);
  }
}

async function archiveScript() {
  if (!activeScript) return;
  const ok = confirm(`📦 Skript „${activeScript.title}“ archivieren?\n\nArchivierte Skripte bleiben erhalten, werden aber in der Hauptansicht ausgeblendet. Du kannst sie über die Archiv-Ansicht wiederherstellen.`);
  if (!ok) return;
  try {
    const res = await fetch(`${API}/scripts/${activeScript.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...activeScript, status: 'archived' })
    });
    if (!res.ok) throw new Error('Archivieren fehlgeschlagen');
    const updated = await res.json();
    const idx = allScripts.findIndex(s => s.id === activeScript.id);
    if (idx >= 0) allScripts[idx] = updated;
    activeScript = updated;
    renderScriptsView();
    showToast('Skript archiviert');
  } catch (e) {
    alert('Fehler beim Archivieren: ' + e.message);
  }
}

async function deleteScript() {
  if (!activeScript) return;
  const ok = confirm(`🗑️ Skript „${activeScript.title}“ wirklich löschen?\n\nDas ist nicht widerrufbar!`);
  if (!ok) return;
  try {
    const res = await fetch(`${API}/scripts/${activeScript.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Löschen fehlgeschlagen');
    allScripts = allScripts.filter(s => s.id !== activeScript.id);
    activeScript = null;
    renderScriptsView();
    showToast('Skript gelöscht');
  } catch (e) {
    alert('Fehler beim Löschen: ' + e.message);
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'scripts-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('scripts-toast--show'), 10);
  setTimeout(() => {
    toast.classList.remove('scripts-toast--show');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

async function saveScript(silent = false) {
  if (!activeScript) return;
  const textarea = document.getElementById('scriptTextarea');
  const titleInput = document.getElementById('scriptTitleInput');
  const content = textarea ? textarea.value : '';
  const title = titleInput ? titleInput.value : activeScript.title;

  try {
    const res = await fetch(`${API}/scripts/${activeScript.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...activeScript, title, content })
    });
    if (!res.ok) throw new Error('Speichern fehlgeschlagen');
    const updated = await res.json();
    const idx = allScripts.findIndex(s => s.id === updated.id);
    if (idx !== -1) allScripts[idx] = updated;
    activeScript = updated;
    isDirty = false;
    if (!silent) {
      const status = document.getElementById('saveStatus');
      if (status) { status.textContent = '✓ gespeichert'; status.style.color = '#5a9e7c'; setTimeout(() => { status.textContent = '✓ gespeichert'; status.style.color = ''; }, 2000); }
    } else {
      const status = document.getElementById('saveStatus');
      if (status) status.textContent = '✓ auto-gespeichert';
    }
  } catch (err) {
    console.error(err);
    if (!silent) alert('Fehler beim Speichern: ' + err.message);
  }
}

async function linkScriptToVideo(videoId) {
  if (!activeScript) return;
  try {
    const res = await fetch(`${API}/scripts/${activeScript.id}/link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId || null })
    });
    if (!res.ok) throw new Error('Fehler');
    const updated = await res.json();
    activeScript = updated;
    const idx = allScripts.findIndex(s => s.id === updated.id);
    if (idx !== -1) allScripts[idx] = updated;
    renderScriptsView();
  } catch (err) {
    console.error(err);
  }
}

// ─── Sidebar nav integration ────────────────────────────────────────────────
function setupScriptsNav() {
  document.querySelectorAll('.sidebar__nav-link[data-view="scripts"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.sidebar__nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      document.querySelectorAll('.view-panel').forEach(p => p.style.display = 'none');
      const target = document.getElementById('scriptsView');
      if (target) {
        target.style.display = 'flex';
        target.style.flexDirection = 'column';
        target.style.overflowY = 'auto';
      }
      initScripts();
    });
  });
}

// Note: scripts.js does NOT auto-init on DOMContentLoaded anymore.
// initScripts() is called by app.js setupNav() when scripts view is activated.
// This avoids double-initialization (loadScripts called twice on first load).
