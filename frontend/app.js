/* ==========================================================================
   CONTENTIX FRONTEND — App JS (wired to real backend)
   ========================================================================== */

// ─── State ──────────────────────────────────────────────────────────────────
let allContent = [];
let activeFilter = 'all';
const API = '/api';

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
  // Re-check urgency every minute
  setInterval(updateNextVideo, 60000);
  loadChannelStats();
  loadExpeditionsList();
  document.getElementById('vidiqRefreshBtn')?.addEventListener('click', refreshVidiq);
  setVidiqIdleLabel(); // Show last sync time on page load
  // Load version from API
  fetch(`${API}/health`)
    .then(r => r.json())
    .then(d => { const el = document.getElementById('sidebarVersion'); if (el && d.version) el.textContent = `v${d.version}`; })
    .catch(() => {});
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

// ─── vidIQ Refresh Helpers ────────────────────────────────────────────────────
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

let vidiqCancelToken = null;

async function refreshVidiq() {
  const btn = document.getElementById('vidiqRefreshBtn');
  const status = document.getElementById('vidiqRefreshStatus');

  function setState(label, cls, btnTxt, btnDisabled) {
    status.textContent = label;
    status.className = 'vidiq-refresh-status' + (cls ? ` ${cls}` : '');
    if (btnTxt) btn.textContent = btnTxt;
    btn.disabled = btnDisabled !== undefined ? btnDisabled : true;
  }

  function updateSidebarStats(data) {
    document.getElementById('logbuchSubs').textContent = data.subs || '—';
    document.getElementById('logbuchViews').textContent = data.views || '—';
    document.getElementById('logbuchWatchtime').textContent = data.watchtimeHours ? data.watchtimeHours + ' Std.' : '—';
    document.getElementById('logbuchVideos').textContent = data.videoCount ?? '—';
  }

  setState('Starte vidIQ Refresh...', 'vidiq-refresh-status--loading', '⟳ Abbruch');
  vidiqCancelToken = new AbortController();

  try {
    // Fire refresh job
    const r = await fetch('/api/vidiq/refresh', {
      method: 'POST',
      signal: vidiqCancelToken.signal
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Unbekannt' }));
      setState(`Fehler: ${err.error || r.status}`, 'vidiq-refresh-status--error', '⟳ Retry');
      btn.disabled = false;
      return;
    }

    const { jobId } = await r.json();
    setState('Daten laden... (0%)', 'vidiq-refresh-status--loading', '⟳ Abbrechen');

    // Poll for job status
    let pollCount = 0;
    const poll = async () => {
      if (vidiqCancelToken?.signal?.aborted) return;
      try {
        const sr = await fetch(`/api/vidiq/refresh/status/${jobId}`, { signal: vidiqCancelToken.signal });
        if (!sr.ok) return;
        const job = await sr.json();
        const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
        setState(`Daten laden... (${pct}%)`, 'vidiq-refresh-status--loading', '⟳ Abbrechen');

        if (job.status === 'done') {
          setState('✓ Fertig!', 'vidiq-refresh-status--done', '✓');
          if (job.result) updateSidebarStats(job.result);
          if (typeof pulseSidebarStats === 'function') pulseSidebarStats();
          setTimeout(() => {
            fetch('/api/vidiq/channel-stats').then(async (tr) => {
              if (tr.ok) updateSidebarStats(await tr.json());
            }).catch(() => {});
            btn.textContent = '⟳ vidIQ Refresh';
            btn.disabled = false;
            contentixReload();
          }, 2000);
          return;
        }

        if (job.status === 'error') {
          setState(`Fehler: ${job.error || 'Unbekannt'}`, 'vidiq-refresh-status--error', '⟳ Retry');
          btn.disabled = false;
          return;
        }

        // Still running — poll again in 2s
        pollCount++;
        setTimeout(poll, 2000);
      } catch(e) {
        if (e.name !== 'AbortError') {
          setState(`Netzfehler: ${e.message}`, 'vidiq-refresh-status--error', '⟳ Retry');
          btn.disabled = false;
        }
      }
    };

    poll();

  } catch (e) {
    if (e.name === 'AbortError') {
      setState('Abgebrochen', '', '⟳ vidIQ Refresh');
    } else {
      setState(`Netzfehler: ${e.message}`, 'vidiq-refresh-status--error', '⟳ Retry');
    }
    btn.disabled = false;
  }
}

function cancelVidiqRefresh() {
  if (vidiqCancelToken) vidiqCancelToken.abort();
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
  // scripts/settings views: no vidIQ data to reload
}

function setVidiqIdleLabel() {
  const status = document.getElementById('vidiqRefreshStatus');
  if (!status) return;
  fetch('/api/vidiq/channel-stats').then(r => r.ok ? r.json() : null).then(data => {
    if (data && data._fetched_at) {
      status.textContent = `Letztes Update: ${formatRelativeTime(data._fetched_at)}`;
      status.className = 'vidiq-refresh-status';
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
  if (view === 'bibliothek') { if (typeof loadBibliothek === 'function') loadBibliothek(); }
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
      if (view === 'ideas') { /* kanban renders on DOMContentLoaded */ }
      if (view === 'scripts') { initScripts(); }
      // Persist view in cookie
      document.cookie = `contentix_view=${view};path=/;max-age=${60*60*24*30}`;
    });
  });
}

// ─── Logbuch: Channel Stats ──────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API}/vidiq/channel-stats`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    // Ausrüstung (badges)
    document.getElementById('logbuchSubs').textContent = data.subs ? formatNumber(data.subs) : '—';
    document.getElementById('logbuchViews').textContent = data.views ? formatNumber(data.views) : '—';
    document.getElementById('logbuchWatchtime').textContent = data.watchtimeHours ? `${formatNumber(data.watchtimeHours)} Std.` : '—';
    document.getElementById('logbuchVideos').textContent = data.videoCount ?? '—';

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

// ─── Expeditions-Liste ──────────────────────────────────────────────────────
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

// ─── Channel Stats Widget (Feature 3 & 4) ───────────────────────────────────
async function loadChannelStats() {
  try {
    const res = await fetch(`${API}/vidiq/channel-stats`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    document.getElementById('stat-subs').textContent = formatNumber(data.subs);
    document.getElementById('stat-views').textContent = formatNumber(data.views);
    document.getElementById('stat-watchtime').textContent = data.watchtimeHours ? formatNumber(data.watchtimeHours) + 'h' : 'N/A';
    if (data.latestVideo) {
      document.getElementById('latestVideoTitle').textContent = data.latestVideo.title || 'Unbekannt';
      document.getElementById('latestVideoLink').href = 'https://youtube.com/watch?v=' + data.latestVideo.videoId;
      if (data.latestVideo.thumbnail) {
        document.getElementById('latestVideoThumb').src = data.latestVideo.thumbnail;
        document.getElementById('latestVideoThumb').style.background = 'none';
      }
    } else {
      document.getElementById('latestVideoTitle').textContent = 'Kein Video gefunden';
      document.getElementById('latestVideoLink').href = '#';
    }
  } catch (_) {
    document.getElementById('stat-subs').textContent = 'N/A';
    document.getElementById('stat-views').textContent = 'N/A';
    document.getElementById('stat-watchtime').textContent = 'N/A';
    document.getElementById('latestVideoTitle').textContent = 'Fehler beim Laden';
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

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeCardModal(); closeCalendarDayDetail && closeCalendarDayDetail(); }
  if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    openModal();
  }
});
