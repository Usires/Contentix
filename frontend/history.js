// ─── Contentix History View (HIST v1.0) ────────────────────────────────────────

let allHistoryVideos = [];
let currentHistoryFilter = 'all';

async function initHistory() {
  await loadHistory();
  const filterEl = document.getElementById('historyFilter');
  if (filterEl) {
    filterEl.addEventListener('change', (e) => {
      currentHistoryFilter = e.target.value;
      renderHistoryView();
    });
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`${API}/history`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allHistoryVideos = await res.json();
    updateHistoryBadge();
    renderHistoryView();
  } catch (err) {
    const content = document.getElementById('historyContent');
    if (content) {
      content.innerHTML = `<div class="history-empty"><p>Fehler beim Laden: ${escapeHtml(err.message)}</p></div>`;
    }
  }
}

function updateHistoryBadge() {
  const badge = document.getElementById('historyCount');
  if (badge) badge.textContent = allHistoryVideos.length;
}

function renderHistoryView() {
  const content = document.getElementById('historyContent');
  if (!content) return;

  // Apply filter
  const filtered = applyHistoryFilter(allHistoryVideos);

  if (filtered.length === 0) {
    content.innerHTML = `<div class="history-empty">
      <p>Keine veröffentlichten Videos${currentHistoryFilter !== 'all' ? ' mit diesem Filter' : ''}.</p>
    </div>`;
    return;
  }

  // Group by year
  const byYear = groupByYear(filtered);

  let html = '';
  for (const [year, videos] of byYear) {
    html += `<section class="history-year">
      <h3 class="history-year__heading">${year} <span class="history-year__count">(${videos.length})</span></h3>
      <div class="history-cards">`;
    for (const v of videos) {
      html += renderHistoryCard(v);
    }
    html += `</div></section>`;
  }

  content.innerHTML = html;
}

function applyHistoryFilter(videos) {
  switch (currentHistoryFilter) {
    case 'longform': return videos.filter(v => (v.video_format || 'longform') === 'longform');
    case 'shorts':   return videos.filter(v => v.video_format === 'shorts');
    case 'livestream': return videos.filter(v => v.video_format === 'livestream');
    case 'remake':   return videos.filter(v => v.parent_video_id);
    default:         return videos;
  }
}

function groupByYear(videos) {
  const map = new Map();
  for (const v of videos) {
    const year = v.published_date ? new Date(v.published_date).getFullYear() : 'Unbekannt';
    if (!map.has(year)) map.set(year, []);
    map.get(year).push(v);
  }
  // Sort years DESC (newest first); videos inside each year already sorted by published_date DESC
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

function renderHistoryCard(v) {
  const date = v.published_date ? formatHistoryDate(v.published_date) : '';
  const thumb = v.thumbnail_url || v.youtube_url ? extractYouTubeId(v.youtube_url) : null;
  const thumbStyle = thumb
    ? `background-image: url('https://i.ytimg.com/vi/${thumb}/mqdefault.jpg');`
    : '';
  const tags = (v.tags || []).slice(0, 3).map(t => `<span class="history-card__tag">#${escapeHtml(t)}</span>`).join('');
  const remake = v.parent_video_id
    ? `<div class="history-card__remake">🔄 Remake von <em>${escapeHtml(v.parent_title || '—')}</em></div>`
    : '';
  const fmt = v.video_format || 'longform';
  const fmtBadge = fmt !== 'longform' ? `<span class="history-card__format">${escapeHtml(fmt)}</span>` : '';

  return `<article class="history-card" data-video-id="${escapeHtml(v.id)}" onclick="openHistoryVideo('${escapeHtml(v.id)}')">
    <div class="history-card__thumb" style="${thumbStyle}">${!thumb ? '📺' : ''}${fmtBadge}</div>
    <div class="history-card__body">
      <h4 class="history-card__title">${escapeHtml(v.title || 'Unbenannt')}</h4>
      <div class="history-card__meta">
        <span>📅 ${date}</span>
        ${v.youtube_url ? `<a href="${escapeHtml(v.youtube_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶ YouTube</a>` : ''}
      </div>
      ${tags ? `<div class="history-card__tags">${tags}</div>` : ''}
      ${remake}
    </div>
  </article>`;
}

function formatHistoryDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function openHistoryVideo(id) {
  // Open the same video-edit modal that the kanban board uses
  if (typeof openCardModal === 'function') {
    openCardModal(id);
  } else if (typeof window.openCardModal === 'function') {
    window.openCardModal(id);
  } else {
    // Fallback: navigate to library view
    const link = document.querySelector('.sidebar__nav-link[data-view="bibliothek"]');
    if (link) link.click();
  }
}

function openArchiveView() {
  // Placeholder for archive view (will be implemented in a follow-up)
  showToast('Archiv-View kommt in einer späteren Version', 'info');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
