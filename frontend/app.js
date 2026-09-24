/* ==========================================================================
   CONTENTIX FRONTEND — App JS (wired to real backend)
   ========================================================================== */

// ─── State ──────────────────────────────────────────────────────────────────
let allContent = [];
let activeFilter = 'all';
const API = '/api';

// ─── Vidi 2.0 Status (Phase 1.2, 2026-09-17) ─────────────────────────────────
// Cached globally so kanban.js can render the Inbox lane conditionally.
// IMPORTANT: assigned to window.* so kanban.js (different file scope) can read it.
window.vidiStatus = { installed: false };

async function fetchVidiStatus() {
  try {
    const res = await fetch(`${API}/vidi/status`);
    if (!res.ok) return;
    window.vidiStatus = await res.json();
    // Trigger a kanban re-render if the board is currently shown.
    if (typeof window.refreshKanbanBoard === 'function') {
      window.refreshKanbanBoard();
    }
    // Phase 1.2 defensive: re-render sidebar Vidi-status if such an element exists.
    if (typeof window.refreshVidiSidebar === 'function') {
      window.refreshVidiSidebar();
    }
  } catch (e) {
    // Vidi not installed or unreachable — graceful, no error to user.
    window.vidiStatus = { installed: false };
  }
}

function vidiIsInstalled() {
  return window.vidiStatus && window.vidiStatus.installed === true;
}

// Phase 1.2 defensive: Setup a document-level fallback click handler for vidi-toggle.
// This fires EVEN IF the delegated listener on #kanbanBoard doesn't catch the click —
// covers cases where the button is rendered outside the board (e.g. sidebar) or where
// the parent's event delegation isn't reachable (e.g. due to position:absolute).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="toggle-vidi-inbox"]');
  if (!btn) return;
  // Only fire if the kanban-delegated handler hasn't already handled this.
  // We check by setting a tiny flag on the event; kanban.js handler will set it.
  if (e._vidiToggleHandled) return;
  e._vidiToggleHandled = true;
  if (typeof window.toggleVidiInbox === 'function') {
    window.toggleVidiInbox();
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadContent();
  setupFilters();
  setupModal();
  setupNav();
  loadStats();
  // loadVideosList moved to expeditions page
  loadNixComment();
  restoreView();
  restoreTheme();
  updateNextVideo();
  // Pre-load history so the sidebar badge shows the real count instead
  // of '0' on initial page load. initHistory() fetches /api/history and
  // populates allHistoryVideos + updates the badge — running it here
  // means the count is correct before the user clicks History.
  if (typeof initHistory === 'function') initHistory();
  // Re-check urgency every minute
  setInterval(updateNextVideo, 60000);
  loadChannelStats();
  loadExpeditionsList();
  document.getElementById('youtubeRefreshBtn')?.addEventListener('click', refreshYouTube);
      // Load version from API
  fetch(`${API}/health`)
    .then(r => r.json())
    .then(d => { const el = document.getElementById('sidebarVersion'); if (el && d.version) el.textContent = `v${d.version}`; })
    .catch(() => {});
  // Vidi 2.0 detection (Phase 1.2): check if the optional Vidi service is installed.
  // If yes, kanban will render an extra "Vidi-Inbox" lane with proactive suggestions.
  fetchVidiStatus();
  // Refresh every 60s so status-changes (service start/stop) propagate.
  setInterval(fetchVidiStatus, 60000);
});

// ─── Load Videos from Backend ─────────────────────────────────────────────────
async function loadContent() {
  const grid = document.getElementById('contentGrid');
  grid.innerHTML = `
    <div class="loading">
      <div class="loading__spinner"></div>
      <p class="loading__text">Content wird geladen...</p>
    </div>`;

  try {
    const res = await fetch(`${API}/videos`);
    if (!res.ok) throw new Error('API nicht erreichbar');
    allContent = await res.json();
    renderContent();
  } catch (err) {
    grid.innerHTML = `
      <div class="content-card" style="grid-column: 1/-1; text-align: center; padding: 60px;">
        <p style="font-size: 15px; color: var(--text-error);">
          ⚠ Fehler beim Laden: ${escapeHtml(err.message)}<br>
          <a href="#" onclick="loadContent(); return false;" style="color: var(--nix-violet);">⟳ Erneut versuchen</a>
        </p>
      </div>`;
  }
}

// ─── Render Content Cards ────────────────────────────────────────────────────
function renderContent() {
  const grid = document.getElementById('contentGrid');

  // Filter
  let filtered = allContent;
  if (activeFilter !== 'all') {
    filtered = allContent.filter(c => {
      if (activeFilter === 'shorts') return c.video_format === 'shorts';
      if (activeFilter === 'livestream') return c.video_format === 'livestream';
      return c.video_format === 'longform' || c.video_format === 'video';
    });
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="content-card" style="grid-column: 1/-1; text-align: center; padding: 60px;">
        <p style="font-size: 15px; color: var(--text-muted);">
          Keine Videos hier. 💫<br>
          <a href="#" onclick="openModal(); return false;" style="color: var(--nix-violet);">Plan was Neues!</a>
        </p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const badge = item.video_format === 'shorts' ? 'short' : item.video_format;
    const cardClass = item.video_format === 'shorts'
      ? 'content-card content-card--shorts'
      : item.status === 'published'
      ? 'content-card content-card--featured'
      : 'content-card';
    return `
    <article class="${cardClass}" data-id="${item.id}">
      <div class="content-card__meta">
        <span class="content-card__badge content-card__badge--${badge}">${categoryLabel(item.video_format)}</span>
        <span class="content-card__date">${formatDate(item.planned_date || item.published_date)}</span>
      </div>
      <h3 class="content-card__title">${escapeHtml(item.title)}</h3>
      ${item.notes ? `<p class="content-card__excerpt">${escapeHtml(item.notes)}</p>` : ''}
      <div class="content-card__footer">
        <span class="content-card__tag">${item.nix_comment ? '💬 Nix kommentiert' : '—'}</span>
        <a href="#" class="content-card__action" onclick="editItem('${item.id}'); return false;">
          Bearbeiten
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </a>
      </div>
    </article>`;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function categoryLabel(cat) {
  const map = { video: 'Video', shorts: 'Short', livestream: 'Livestream', longform: 'Video' };
  return map[cat] || 'Video';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}


// ─── Filter Chips ───────────────────────────────────────────────────────────
function setupFilters() {
  document.querySelectorAll('.filter-bar__chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-bar__chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderContent();
    });
  });
}

// ─── YouTube Refresh Helpers ────────────────────────────────────────────────────
function formatRelativeTime(date) {
  if (!date) return null;
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

let youtubeRefreshCancelToken = null;

// Snapshot of credit balance taken right before firing a refresh, so we can
// show the delta (e.g. "−14 Credits verbraucht") once the job finishes.
let youtubePreRefreshState = null;

// Pre-flight credit check thresholds.
// REFRESH_MIN_CREDITS: below this, refuse to start the refresh entirely
// (the MCP call would just fail and burn the user's time). 7 = enough for the
// 6 init steps + a watchtime, but tight; 10 gives breathing room for retries.
// WARN_LOW_CREDITS: warn but proceed — user might want to refresh anyway.
const REFRESH_MIN_CREDITS = 10;
const WARN_LOW_CREDITS = 30;

async function refreshYouTube() {
  // Phase 2: replaces refreshVidiq(). YouTube Data API is free and has no
  // credit-balance concept, so this is much simpler — no balance check, no
  // No credit warnings or fallback needed (YouTube Data API is free).
  // poll progress. Cancellable via AbortController.
  const btn = document.getElementById('youtubeRefreshBtn');
  const status = document.getElementById('youtubeRefreshStatus');

  function setState(label, cls, btnTxt, btnDisabled) {
    status.textContent = label;
    status.className = 'youtube-refresh-status' + (cls ? ` ${cls}` : '');
    if (btnTxt) btn.textContent = btnTxt;
    btn.disabled = btnDisabled !== undefined ? btnDisabled : true;
  }

  // Reuse youtubeRefreshCancelToken for now (we'll rename if/when the button gets renamed).
  // Existing event handler at line 31 also points to this variable, so we
  // don't need to rewire anything.
  youtubeRefreshCancelToken = new AbortController();
  setState('YouTube Refresh startet...', 'youtube-refresh-status--loading', '⟳ YouTube Refresh');

  try {
    const r = await fetch('/api/youtube/refresh', { method: 'POST', signal: youtubeRefreshCancelToken.signal });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Unbekannt' }));
      setState('Fehler: ' + (err.error || r.status), 'youtube-refresh-status--error', '⟳ Retry');
      btn.disabled = false;
      return;
    }
    const { jobId } = await r.json();
    setState('Daten laden... (0%)', 'youtube-refresh-status--loading', '⟳ Abbrechen');

    const poll = async () => {
      if (youtubeRefreshCancelToken?.signal?.aborted) return;
      try {
        const sr = await fetch('/api/youtube/refresh/status/' + jobId, { signal: youtubeRefreshCancelToken.signal });
        if (!sr.ok) return;
        const job = await sr.json();
        const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
        const label = job.currentStep || ('Daten laden... (' + pct + '%)');
        setState(label + ' · ' + pct + '%', 'youtube-refresh-status--loading', '⟳ Abbrechen');
        if (job.status === 'done') {
          const cached = job.result && job.result.videosCached != null
            ? ` (${job.result.videosCached} Videos)`
            : '';
          setState('✓ Fertig!' + cached, 'youtube-refresh-status--done', '✓');
          // Refresh sidebar stats from the new cache
          loadStats();
          setTimeout(() => { btn.disabled = false; }, 1500);
          return;
        }
        if (job.status === 'failed') {
          setState('✗ Fehler: ' + (job.error || 'unbekannt'), 'youtube-refresh-status--error', '⟳ Retry');
          btn.disabled = false;
          return;
        }
        if (job.status === 'cancelled') {
          setState('Abgebrochen.', 'youtube-refresh-status--error', '⟳ Retry');
          btn.disabled = false;
          return;
        }
        setTimeout(poll, 1500);
      } catch (e) {
        if (e.name === 'AbortError') return;
        // transient network blip — retry next tick
        setTimeout(poll, 3000);
      }
    };
    setTimeout(poll, 500);
  } catch (e) {
    if (e.name === 'AbortError') return;
    setState('Fehler: ' + e.message, 'youtube-refresh-status--error', '⟳ Retry');
    btn.disabled = false;
  }
}
function cancelVidiqRefresh() {
  if (youtubeRefreshCancelToken) youtubeRefreshCancelToken.abort();
}

function contentixReload() {
  // Reload whatever view is currently visible
  const ideasEl = document.getElementById('ideasView');
  const calendarEl = document.getElementById('calendarView');
  const bibliothekEl = document.getElementById('bibliothekView');
  if (ideasEl && ideasEl.style.display !== 'none') {
    loadCards(); // kanban.js global
  } else if (calendarEl && calendarEl.style.display !== 'none') {
    renderCalendar(); // calendar.js global
  } else if (bibliothekEl && bibliothekEl.style.display !== 'none') {
    if (typeof loadBibliothek === 'function') loadBibliothek();
  }
  // scripts/settings views: no YouTube data to reload either
}

function setVidiqIdleLabel() {
  const status = document.getElementById('youtubeRefreshStatus');
  if (!status) return;
  fetch('/api/youtube/channel-stats').then(r => r.ok ? r.json() : null).then(data => {
    if (data && data._fetched_at) {
      status.textContent = `Letztes Update: ${formatRelativeTime(data._fetched_at)}`;
      status.className = 'youtube-refresh-status';
    }
  }).catch(() => {});
}

// ─── Modal ──────────────────────────────────────────────────────────────────
function setupModal() {
  document.getElementById('addContentBtn')?.addEventListener('click', () => openModal());
  document.getElementById('cancelModal')?.addEventListener('click', closeModal);
  document.getElementById('contentForm')?.addEventListener('submit', handleSubmit);
  document.querySelector('.modal__backdrop')?.addEventListener('click', closeModal);
}

function openModal(id = null) {
  const modal = document.getElementById('contentModal');
  const form = document.getElementById('contentForm');
  form.reset();
  if (id) {
    const item = allContent.find(c => c.id === id);
    if (item) {
      form.title.value = item.title || '';
      form.category.value = item.video_format || 'video';
      form.tags.value = item.tags ? item.tags.join(', ') : '';
      form.description.value = item.notes || '';
      form.dataset.editId = id;
    }
  } else {
    delete form.dataset.editId;
  }
  modal.style.display = 'flex';
  focusFirstField('contentModal');
}

function closeModal() {
  document.getElementById('contentModal').style.display = 'none';
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.editId;
  const categoryMap = { video: 'longform', shorts: 'shorts', livestream: 'livestream' };

  const payload = {
    title: form.title.value,
    video_format: categoryMap[form.category.value] || 'longform',
    tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
    notes: form.description.value,
    planned_date: form.planned_date?.value
      ? (form.planned_time?.value
        ? form.planned_date.value + 'T' + form.planned_time.value + ':00'
        : form.planned_date.value)
      : null
  };

  try {
    const url = id ? `${API}/videos/${id}` : `${API}/videos`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Speichern fehlgeschlagen');
    closeModal();
    loadContent();
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

function editItem(id) {
  openModal(id);
}

// ─── Sidebar Navigation ─────────────────────────────────────────────────────
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setTheme(theme) {
  // Remove all theme classes
  document.body.classList.remove('theme-spring', 'theme-summer', 'theme-autumn', 'theme-winter');
  if (theme) document.body.classList.add('theme-' + theme);
  // Persist
  document.cookie = `contentix_theme=${theme};path=/;max-age=${60*60*24*365}`;
  // Update button states
  document.querySelectorAll('.theme-btn').forEach(btn => {
    const t = btn.dataset.theme || '';
    btn.style.borderColor = (t === theme) ? 'var(--nix-violet)' : 'var(--border-subtle)';
  });
}

function restoreTheme() {
  const saved = getCookie('contentix_theme') || '';
  setTheme(saved);
}

// ─── YouTube cache settings (Phase 2) ─────────────────────────────────────────
function loadYouTubeCacheSettings() {
  // Defaults (used if server is unreachable or first-time load)
  const defaults = {
    channel: 1, video: 24, analytics: 24, maxVideos: 10, interval: 5,
  };
  // Try server first (authoritative)
  fetch('/api/youtube/cache-settings')
    .then(r => r.ok ? r.json() : null)
    .then(serverSettings => {
      // Fall back to localStorage, then defaults
      const saved = JSON.parse(localStorage.getItem('yt_cache_settings') || '{}');
      const s = serverSettings || Object.assign({}, defaults, saved);
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      setVal('yt-cache-channel', s.channelTtlHours ?? s.channel ?? defaults.channel);
      setVal('yt-cache-video', s.videoTtlHours ?? s.video ?? defaults.video);
      setVal('yt-cache-analytics', s.analyticsTtlHours ?? s.analytics ?? defaults.analytics);
      setVal('yt-refresh-max', s.refreshMaxVideos ?? s.maxVideos ?? defaults.maxVideos);
      setVal('yt-refresh-interval', s.refreshMinIntervalMinutes ?? s.interval ?? defaults.interval);
    })
    .catch(() => {
      // Offline / server down: use localStorage or defaults
      const saved = JSON.parse(localStorage.getItem('yt_cache_settings') || '{}');
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      setVal('yt-cache-channel', saved.channel ?? defaults.channel);
      setVal('yt-cache-video', saved.video ?? defaults.video);
      setVal('yt-cache-analytics', saved.analytics ?? defaults.analytics);
      setVal('yt-refresh-max', saved.maxVideos ?? defaults.maxVideos);
      setVal('yt-refresh-interval', saved.interval ?? defaults.interval);
    });
}

function saveYouTubeCacheSettings() {
  const getNum = id => parseFloat(document.getElementById(id).value);
  const getInt = id => parseInt(document.getElementById(id).value, 10);
  const settings = {
    channel: getNum('yt-cache-channel'),
    video: getNum('yt-cache-video'),
    analytics: getNum('yt-cache-analytics'),
    maxVideos: getInt('yt-refresh-max'),
    interval: getInt('yt-refresh-interval'),
  };
  localStorage.setItem('yt_cache_settings', JSON.stringify(settings));
  const statusEl = document.getElementById('yt-cache-saved-status');
  fetch('/api/youtube/cache-settings', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(settings),
  }).then(r => {
    if (r.ok) {
      statusEl.textContent = '✅ gespeichert';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } else {
      statusEl.textContent = '⚠️ Server-Fehler';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
  }).catch(() => {
    statusEl.textContent = '⚠️ Server nicht erreichbar — lokal gespeichert';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  });
}

// Hook into the existing page-load flow
document.addEventListener('DOMContentLoaded', loadYouTubeCacheSettings);


function restoreView() {
  const saved = getCookie('contentix_view');
  const view = saved || 'bibliothek';
  document.querySelectorAll('.sidebar__nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.sidebar__nav-link[data-view="${view}"]`)?.classList.add('active');
  document.querySelectorAll('.view-panel').forEach(p => p.style.display = 'none');
  const targetView = document.getElementById(`${view}View`);
  if (targetView) {
    targetView.style.display = 'flex';
    targetView.style.flexDirection = 'column';
    targetView.style.overflowY = 'auto';
  }
  if (view === 'calendar') renderCalendar();
  if (view === 'ideas') { loadCards(); }
  if (view === 'scripts') { initScripts(); }
  if (view === 'history') { initHistory(); }
  if (view === 'bibliothek') { if (typeof loadBibliothek === 'function') loadBibliothek(); }
  // Server-Logs: nur Auto-Refresh, wenn Settings-Tab aktiv ist
  if (typeof window.ContentixLogs !== 'undefined') {
    if (view === 'settings') window.ContentixLogs.start();
    else window.ContentixLogs.stop();
  }
}

function setupNav() {
  document.querySelectorAll('.sidebar__nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.sidebar__nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      const view = link.dataset.view;
      document.querySelectorAll('.view-panel').forEach(p => p.style.display = 'none');
      const targetView = document.getElementById(`${view}View`);
      if (targetView) {
        targetView.style.display = 'flex';
        targetView.style.flexDirection = 'column';
        targetView.style.overflowY = 'auto';
      }
      if (view === 'calendar') renderCalendar();
      if (view === 'bibliothek') { if (typeof loadBibliothek === 'function') loadBibliothek(); }
      // Server-Logs: Auto-Refresh nur bei Settings-Tab
      if (typeof window.ContentixLogs !== 'undefined') {
        if (view === 'settings') window.ContentixLogs.start();
        else window.ContentixLogs.stop();
      }
      if (view === 'ideas') { /* kanban renders on DOMContentLoaded */ }
      if (view === 'scripts') { initScripts(); }
      if (view === 'history') { initHistory(); }
      // Persist view in cookie
      document.cookie = `contentix_view=${view};path=/;max-age=${60*60*24*30}`;
    });
  });
}

// ─── Logbuch: Channel Stats ──────────────────────────────────────────────
async function loadStats() {
  try {
    // Phase 2: switched from /api/vidiq/channel-stats to /api/youtube/channel-stats (kept as a comment for git-blame continuity)
    // (vidIQ MCP replaced by self-hosted YouTube MCP at :8190). Same response shape, just YouTube fields now.
    // (subs/views/videoCount/cached/_fetched_at), so the rest of this function is unchanged.
    const res = await fetch(`${API}/youtube/channel-stats`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    // Ausrüstung (badges)
    document.getElementById('logbuchSubs').textContent = data.subs ? formatNumber(data.subs) : '—';
    document.getElementById('logbuchViews').textContent = data.views ? formatNumber(data.views) : '—';
    document.getElementById('logbuchVideos').textContent = data.videoCount ?? '—';

    // Channel avatar + handle (Phase 2 — YouTube thumbnail feature)
    const avatar = document.getElementById('channelAvatar');
    if (avatar && data.thumbnail) avatar.src = data.thumbnail;
    const handleEl = document.getElementById('channelHandle');
    if (handleEl && data.customUrl) handleEl.textContent = data.customUrl;

    // Watchtime now from /api/youtube/analytics (OAuth-backed, free, 28d window)
    loadWatchtime();

    // Letzte Expedition widget removed — now in Bibliothek
  } catch (_) {
    document.getElementById('logbuchSubs').textContent = '—';
    document.getElementById('logbuchViews').textContent = '—';
    document.getElementById('logbuchWatchtime').textContent = '—';
    document.getElementById('logbuchVideos').textContent = '—';
  }

  // Nächstes Video Widget
  updateNextVideo();
}

// Fetch the watchtime in the background (Phase 2: free, no credits).
// 0 on a hit. The sidebar shows a spinner until it lands.
async function loadWatchtime() {
  const el = document.getElementById('logbuchWatchtime');
  if (!el) return;
  const previous = el.textContent;
  if (el.textContent === '—') el.textContent = '…';
  try {
    // Phase 2: YouTube Analytics via /api/youtube/analytics
    // Response shape: { minutes, hours, averageViewDuration, subscribersGained, views, windowDays, cached, fetchedAt }
    const r = await fetch(`${API}/youtube/analytics`);
    if (!r.ok) throw new Error(`API ${r.status}`);
    const w = await r.json();
    el.textContent = w.hours ? `${formatNumber(w.hours)} Std.` : '—';
    // YouTube returns avgViewDuration in seconds; convert to minutes:seconds for display
    const avgSec = w.averageViewDuration || 0;
    const avgStr = avgSec ? `${Math.floor(avgSec/60)}:${String(avgSec%60).padStart(2,'0')} min` : '?';
    el.title = w.cached
      ? `Cache: YouTube Analytics (28d) · ${w.subscribersGained || '?'} neue Subs · Ø ${avgStr}`
      : `Frisch geladen · 28-Tage-Fenster · ${w.subscribersGained || '?'} neue Subs · Ø ${avgStr}`;
  } catch (_) {
    el.textContent = previous || '—';
  }
}



// ─── Nächstes Video Widget ───────────────────────────────────────────────
async function updateNextVideo() {
  try {
    const res = await fetch(`${API}/videos`);
    if (!res.ok) throw new Error('API error');
    const cards = await res.json();

    const todayStr = new Date().toISOString().split('T')[0];
    const upcoming = cards
      .filter(c => {
        if (!c.planned_date) return false;
        const d = c.planned_date.split('T')[0];
        return d >= todayStr;
      })
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date));

    const widget = document.getElementById('nextVideoWidget');
    const labelEl = widget?.querySelector('.next-video-widget__label');

    // Remove urgency classes
    widget?.classList.remove('widget-urgent-far', 'widget-urgent-close', 'widget-urgent-critical', 'widget-urgent-live');
    if (labelEl) labelEl.style.color = '';

    if (upcoming.length > 0) {
      const next = upcoming[0];
      const date = new Date(next.planned_date).toLocaleDateString('de-DE', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
      document.getElementById('nextVideoTitle').textContent = next.title || '—';
      document.getElementById('nextVideoMeta').textContent = `📅 ${date}`;

      // Compute urgency
      const planDate = next.planned_date.split('T')[0];
      const daysUntil = Math.ceil((new Date(planDate) - new Date(todayStr)) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 0) {
        widget?.classList.add('widget-urgent-live');
        if (labelEl) labelEl.style.color = '#ff4444';
      } else if (daysUntil === 1) {
        widget?.classList.add('widget-urgent-critical');
        if (labelEl) labelEl.style.color = 'var(--coral)';
      } else if (daysUntil <= 3) {
        widget?.classList.add('widget-urgent-close');
      } else {
        widget?.classList.add('widget-urgent-far');
      }
    } else {
      document.getElementById('nextVideoTitle').textContent = 'Keine Videos geplant';
      document.getElementById('nextVideoMeta').textContent = '—';
    }
  } catch (_) {
    document.getElementById('nextVideoTitle').textContent = '—';
    document.getElementById('nextVideoMeta').textContent = '—';
  }
}


// ─── Nix Comment (from first video with a comment) ──────────────────────────
async function loadNixComment() {
  try {
    const res = await fetch(`${API}/videos`);
    if (res.ok) {
      const videos = await res.json();
      const commented = videos.find(v => v.nix_comment && v.nix_comment.trim());
      if (commented) {
        document.getElementById('nixComment').textContent = commented.nix_comment;
      }
    }
  } catch (_) {
    // Silent fail
  }
}


// ─── Expeditions-Liste (Sidebar-Veröffentlichungen) ────────────────────────
async function loadExpeditionsList() {
  const container = document.getElementById('expeditionsList');
  if (!container) return;
  try {
    const res = await fetch(`${API}/videos?status=published`);
    if (!res.ok) throw new Error('API error');
    const videos = await res.json();
    container.innerHTML = '';
    videos.slice(0, 20).forEach(v => {
      const thumb = v.thumbnail_url || (v.video_id ? `https://i.ytimg.com/vi/${v.video_id}/maxresdefault.jpg` : '');
      const date = v.published_date ? new Date(v.published_date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
      const ytUrl = v.youtube_url || (v.video_id ? `https://youtube.com/watch?v=${v.video_id}` : '#');
      const title = escapeHtml(v.title || 'Ohne Titel');

      const card = document.createElement('div');
      card.className = 'expedition-card';
      card.innerHTML = `
        <img class="expedition-card__thumb" src="${thumb}" alt="${title}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${v.video_id}/maxresdefault.jpg'">
        <div class="expedition-card__body">
          <div class="expedition-card__title">${title}</div>
          <div class="expedition-card__meta">📅 ${date}</div>
          <a class="expedition-card__link" href="${ytUrl}" target="_blank">▶ Auf YouTube</a>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (_) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px;text-align:center;">Fehler beim Laden.</div>';
  }
}

async function loadChannelStats() {
  // Phase 2: unified with loadStats() — single source of YouTube data
  return loadStats();
}

