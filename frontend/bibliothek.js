// Bibliothek View — Video Library (extracted from bibliothek.html)
const BIBLIO_API = '/api';

const BIBLIO_CATS = {
  gaming:    { label: 'Gaming',     color: '#e05565' },
  tutorial:  { label: 'Tutorial',   color: '#4a90d9' },
  nostalgie: { label: 'Nostalgie',  color: '#e87c3e' },
  experiment:{ label: 'Experiment',  color: '#9b6dff' },
  review:    { label: 'Review',      color: '#34d399' },
};

function getCatFromTitle(title) {
  const t = title.toLowerCase();
  if (t.includes('linux') || t.includes('tutorial') || t.includes('setup') || t.includes('installieren')) return 'tutorial';
  if (t.includes('nostalgie') || t.includes('retro') || t.includes('1990') || t.includes('2000')) return 'nostalgie';
  if (t.includes('review') || t.includes('test')) return 'review';
  if (t.includes('experiment')) return 'experiment';
  return 'gaming';
}

function formatViews(n) {
  if (!n || n === 0) return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(0)+'K';
  return String(n);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}

function makeVideoRow(v, rank, showThumb) {
  const cat = v.category || getCatFromTitle(v.title);
  const cfg = BIBLIO_CATS[cat] || BIBLIO_CATS.gaming;
  const views = v.views || 0;

  const rankEl = rank <= 3
    ? `<span class="rank">${['🥇','🥈','🥉'][rank-1]}</span>`
    : `<span class="rank">${rank}</span>`;

  const thumbEl = showThumb && v.thumbnail_url
    ? `<span class="thumb"><img src="${v.thumbnail_url}" alt="" onerror="this.parent.innerHTML='<div class=\\'thumb-placeholder\\'>🎬</div>'"></span>`
    : (showThumb ? `<span class="thumb"><div class="thumb-placeholder">🎬</div></span>` : '');

  const dateStr = formatDate(v.publishedAt || v.published_date);

  return `
    <a class="video-row${rank <= 3 ? ' top3' : ''}" href="${v.youtube_url || '#'}" target="_blank" rel="noopener">
      ${rankEl}
      ${thumbEl}
      <span class="cat-dot ${cat}"></span>
      <span class="title" title="${v.title}">${v.title}</span>
      <div class="meta">
        <span class="views">${formatViews(views)}</span>
        ${dateStr ? `<span class="cat-badge ${cat}">${dateStr}</span>` : ''}
      </div>
    </a>
  `;
}

async function loadBibliothek() {
  const subtitle = document.querySelector('.bibliothek-subtitle');
  const newestList = document.getElementById('newestList');
  const topList = document.getElementById('topList');
  const newestCount = document.getElementById('newestCount');
  const topCount = document.getElementById('topCount');
  if (!newestList) return; // not visible

  if (subtitle) subtitle.textContent = 'Lade Daten...';

  try {
    const res = await fetch(`${BIBLIO_API}/videos-with-stats`);
    if (!res.ok) throw new Error('API error');
    const videos = await res.json();

    if (subtitle) subtitle.textContent = `${videos.length} Videos — sortiert und übersichtlich`;

    videos.forEach(v => { v.category = getCatFromTitle(v.title); });

    const newest = [...videos]
      .filter(v => v.publishedAt || v.published_date)
      .sort((a, b) => {
        const da = new Date(a.publishedAt || a.published_date);
        const db = new Date(b.publishedAt || b.published_date);
        return db - da;
      })
      .slice(0, 10);

    const top = [...videos]
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 10);

    newestList.innerHTML = newest.length > 0
      ? newest.map((v, i) => makeVideoRow(v, i+1, true)).join('')
      : '<div class="empty">Keine Videos mit Datum</div>';
    topList.innerHTML = top.length > 0
      ? top.map((v, i) => makeVideoRow(v, i+1, true)).join('')
      : '<div class="empty">Keine Videos</div>';
    if (newestCount) newestCount.textContent = newest.length;
    if (topCount) topCount.textContent = top.length;

  } catch(e) {
    if (subtitle) subtitle.textContent = 'Fehler: ' + e.message;
    newestList.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
    topList.innerHTML = '<div class="empty">Fehler: ' + e.message + '</div>';
  }
}
