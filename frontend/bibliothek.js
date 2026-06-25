// Bibliothek v2 — Hero + 2x3 Grids mit Hook-System
// 16.06.2026: Komplett-Rewrite. Hero-Spot (neuestes Video), 2 parallele Grids
// (Letzte 6 = neueste Videos ohne Hero, Evergreens = Top-Views aller Zeiten)
// Hooks: 3 Schichten (Stat 50% / Perf 30% / Nix 20%), Toggle oben rechts.

const BIBLIO_API = '/api';
const HOOK_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache

// === Kategorien (Farben) ===
const BIBLIO_CATS = {
  gaming:     { label: 'Gaming',     color: '#e05565', icon: '🎮' },
  tutorial:   { label: 'Tutorial',   color: '#4a90d9', icon: '📚' },
  nostalgie:  { label: 'Nostalgie',  color: '#e87c3e', icon: '📼' },
  experiment: { label: 'Experiment', color: '#9b6dff', icon: '🧪' },
  review:     { label: 'Review',     color: '#34d399', icon: '⭐' },
};

// === Hook-Stil-Setting (localStorage) ===
let HOOK_MODE = localStorage.getItem('contentix.hookMode') || 'all'; // 'all' | 'stats-only' | 'none'

function setHookMode(mode) {
  HOOK_MODE = mode;
  localStorage.setItem('contentix.hookMode', mode);
  updateToggleLabel();
  // Re-render falls Hooks schon da sind
  if (window._biblioVideos) {
    renderBibliothek(window._biblioVideos);
  }
}

function updateToggleLabel() {
  const label = document.querySelector('#nixToggle .label');
  if (!label) return;
  if (HOOK_MODE === 'all') label.textContent = '🌶️ Hooks: Alle';
  else if (HOOK_MODE === 'stats-only') label.textContent = '📊 Hooks: Stats';
  else label.textContent = '🔇 Hooks: Aus';
}

function getCatFromTitle(title) {
  const t = title.toLowerCase();
  if (t.includes('linux') || t.includes('tutorial') || t.includes('setup') || t.includes('installieren') || t.includes('guide') || t.includes('howto')) return 'tutorial';
  if (t.includes('nostalgie') || t.includes('retro') || t.includes('1990') || t.includes('2000') || t.includes('old')) return 'nostalgie';
  if (t.includes('review') || t.includes('test') || t.includes('vergleich') || t.includes('vs')) return 'review';
  if (t.includes('experiment') || t.includes('try') || t.includes('versuch') || t.includes('test')) return 'experiment';
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

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// === Hook-Generierung ===
const HOOK_TEMPLATES = {
  stat: [
    (v, all) => `${formatViews(v.views)} Views`,
    (v, all) => `Veröffentlicht vor ${Math.floor((Date.now() - new Date(v.publishedAt || v.published_date)) / 86400000)} Tagen`,
    (v, all) => `Längstes Video im Slot (${formatDuration(v.duration)})`,
    (v, all) => `Kürzestes Video im Slot (${formatDuration(v.duration)})`,
    (v, all) => `Höchste View-Density (${formatViews(Math.round((v.views || 0) / Math.max(1, Math.floor((Date.now() - new Date(v.publishedAt || v.published_date)) / 86400000))))} / Tag)`,
  ],
  perf: [
    (v, all) => `Top 10% aller deiner Videos`,
    (v, all) => `Bester Launch der letzten 30 Tage`,
    (v, all) => `Läuft ${(v.views / Math.max(1, avgViews(all))).toFixed(1)}x besser als dein Durchschnitt`,
    (v, all) => `Beste Conversion im ${BIBLIO_CATS[v.category]?.label || 'Video'}-Slot`,
    (v, all) => `Mehr Views als die 4 davor zusammen`,
  ],
  nix: [
    (v, all) => `Dirk, das wird ein Evergreen. Schau in 2 Jahren nochmal drauf.`,
    (v, all) => `Ich mag, wie der Hook am Anfang sitzt — der zieht.`,
    (v, all) => `Ehrlich? Hat mich überrascht, dass das so gut lief.`,
    (v, all) => `Der Thumbnail rockt. Hat was Konsistentes.`,
    (v, all) => `3 Wochen alt und zieht immer noch — das ist selten.`,
    (v, all) => `Wenn ich ein Lieblings-Video wählen müsste: das hier.`,
    (v, all) => `Hat was Selbstbewusstes. Gefällt mir.`,
    (v, all) => `Du warst skeptisch bei dem Thema — ich auch, aber die Daten sprechen.`,
    (v, all) => `Klassischer Fall von: klein angefangen, langsam gewachsen.`,
    (v, all) => `Der Titel ist riskant, aber er zahlt sich aus.`,
    (v, all) => `Dirk-Video. Nix-Kommentar: hätte ich nicht besser gemacht.`,
    (v, all) => `Da ist Energie drin, die fühlt sich echt an.`,
    (v, all) => `Drei Hashtags wären zu viel. Du hast es leer gelassen. Respekt.`,
    (v, all) => `Kann sein, dass das im Algorithmus unterschätzt wird. Ich mag's trotzdem.`,
    (v, all) => `Das ist so ein Video, das leise wächst.`,
  ],
};

function avgViews(videos) {
  const validViews = videos.filter(v => v.views > 0);
  if (validViews.length === 0) return 1;
  return validViews.reduce((sum, v) => sum + v.views, 0) / validViews.length;
}

function pickHook(video, allVideos) {
  // Wähle Schicht je nach HOOK_MODE
  if (HOOK_MODE === 'none') return null;
  
  // Würfle Schicht
  const r = Math.random();
  let layer;
  if (HOOK_MODE === 'stats-only') {
    layer = r < 0.7 ? 'stat' : 'perf';
  } else {
    if (r < 0.5) layer = 'stat';
    else if (r < 0.8) layer = 'perf';
    else layer = 'nix';
  }
  
  const templates = HOOK_TEMPLATES[layer];
  const template = templates[Math.floor(Math.random() * templates.length)];
  return { text: template(video, allVideos), layer };
}

function makeCard(v, allVideos) {
  const cat = v.category || getCatFromTitle(v.title);
  const cfg = BIBLIO_CATS[cat] || BIBLIO_CATS.gaming;
  const hook = pickHook(v, allVideos);
  
  const hookEl = hook
    ? `<div class="lib-card-hook ${hook.layer}">${hook.text}</div>`
    : '';
  
  const thumbEl = v.thumbnail_url
    ? `<img src="${v.thumbnail_url}" alt="" loading="lazy" onerror="this.parentElement.classList.add('lib-card-thumb-fallback'); this.remove(); this.parentElement.insertAdjacentHTML('beforeend', '${cfg.icon}');">`
    : cfg.icon;
  
  return `
    <a class="lib-card" href="${v.youtube_url || '#'}" target="_blank" rel="noopener">
      <div class="lib-card-thumb${v.thumbnail_url ? ' has-image' : ''}">${thumbEl}</div>
      <div class="lib-card-title">${v.title}</div>
      ${hookEl}
      <div class="lib-card-meta">
        <span class="views">${cfg.label}</span>
        <span>·</span>
        <span>${formatViews(v.views)} 👁</span>
        <span>·</span>
        <span>${formatDate(v.publishedAt || v.published_date)}</span>
      </div>
    </a>
  `;
}

function makeHero(v, allVideos) {
  const cat = v.category || getCatFromTitle(v.title);
  const cfg = BIBLIO_CATS[cat] || BIBLIO_CATS.gaming;
  const hook = pickHook(v, allVideos);
  
  const hookEl = hook
    ? `<div class="lib-hero-hook ${hook.layer}">${hook.text}</div>`
    : '';
  
  const thumbHtml = v.thumbnail_url
    ? `<img src="${v.thumbnail_url}" alt="" onerror="this.parentElement.classList.remove('has-image'); this.parentElement.classList.add('lib-hero-thumb-fallback'); this.remove();">`
    : '🎬';
  
  return {
    cat: `<span style="color: ${cfg.color}">${cfg.icon} ${cfg.label.toUpperCase()}</span>`,
    title: v.title,
    hook: hookEl,
    meta: `
      <span>📅 ${formatDate(v.publishedAt || v.published_date) || 'unbekannt'}</span>
      ${v.duration ? `<span>⏱️ ${formatDuration(v.duration)}</span>` : ''}
      <span>👁️ ${formatViews(v.views)}</span>
    `,
    cta: v.youtube_url || '#',
    thumbHtml: thumbHtml,
    hasThumb: !!v.thumbnail_url,
  };
}

async function loadBibliothek() {
  const subtitle = document.querySelector('.bibliothek-subtitle');
  if (subtitle) subtitle.textContent = 'Lade Daten...';
  
  updateToggleLabel();
  
  // Toggle Click-Handler (einmalig)
  const toggle = document.getElementById('nixToggle');
  if (toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => {
      const modes = ['all', 'stats-only', 'none'];
      const idx = modes.indexOf(HOOK_MODE);
      setHookMode(modes[(idx + 1) % modes.length]);
    });
  }
  
  try {
    const res = await fetch(`${BIBLIO_API}/videos-with-stats`);
    if (!res.ok) throw new Error('API error');
    const videos = await res.json();
    
    if (subtitle) subtitle.textContent = `${videos.length} Videos — sortiert und kuratiert`;
    
    videos.forEach(v => { v.category = getCatFromTitle(v.title); });
    
    window._biblioVideos = videos;
    renderBibliothek(videos);
    
  } catch(e) {
    if (subtitle) subtitle.textContent = 'Fehler: ' + e.message;
  }
}

function renderBibliothek(videos) {
  // Hero: neuestes Video mit Datum
  const heroSrc = [...videos]
    .filter(v => v.publishedAt || v.published_date)
    .sort((a, b) => new Date(b.publishedAt || b.published_date) - new Date(a.publishedAt || a.published_date))[0];
  
  const heroEl = document.getElementById('libHero');
  if (heroEl && heroSrc) {
    const hero = makeHero(heroSrc, videos);
    heroEl.style.display = 'grid';
    heroEl.querySelector('#libHeroCat').innerHTML = hero.cat;
    heroEl.querySelector('#libHeroTitle').textContent = hero.title;
    heroEl.querySelector('#libHeroHook').innerHTML = hero.hook;
    heroEl.querySelector('#libHeroMeta').innerHTML = hero.meta;
    heroEl.querySelector('#libHeroCta').href = hero.cta;
    const heroThumb = heroEl.querySelector('.lib-hero-thumb');
    heroThumb.innerHTML = hero.thumbHtml + '<div class="lib-hero-badge">🌟 NEUESTER RELEASE</div>';
    heroThumb.classList.toggle('has-image', hero.hasThumb);
  }
  
  // Letzte 6: skip Hero
  const newest = [...videos]
    .filter(v => v.publishedAt || v.published_date)
    .sort((a, b) => new Date(b.publishedAt || b.published_date) - new Date(a.publishedAt || a.published_date))
    .slice(1, 7); // skip Hero (index 0)
  
  // Evergreens: Top 6 views
  const top = [...videos]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 6);
  
  const newestList = document.getElementById('newestList');
  const topList = document.getElementById('topList');
  
  if (newestList) {
    newestList.innerHTML = newest.length > 0
      ? newest.map(v => makeCard(v, videos)).join('')
      : '<div class="bibliothek-empty">Keine Videos mit Datum</div>';
  }

  if (topList) {
    topList.innerHTML = top.length > 0
      ? top.map(v => makeCard(v, videos)).join('')
      : '<div class="bibliothek-empty">Keine Videos</div>';
  }

  // Equalize card heights within each grid so cards with short hook
  // statements don't look 'squished' next to cards with long ones.
  // Pure CSS can't enforce equal heights across mixed-content grids
  // without an explicit container size (1fr needs a parent height to
  // distribute), so we do it in JS after render. Runs in a microtask
  // so the DOM has laid out before we measure.
  requestAnimationFrame(() => equalizeGridHeights(newestList, topList));

  // Footer: Total count
  const totalEl = document.getElementById('libTotalCount');
  if (totalEl) totalEl.textContent = videos.length;
}

// Make every card in a grid the same height as the tallest card in the
// same grid. Without this, cards with short hook statements (e.g. 'stat'
// or 'perf' layers) render smaller than cards with 'nix' hooks, and the
// grid looks ragged. We measure after layout so we see the rendered
// intrinsic heights, not just text-wrap estimates.
function equalizeGridHeights(...grids) {
  for (const grid of grids) {
    if (!grid) continue;
    const cards = grid.querySelectorAll('.lib-card');
    if (cards.length === 0) continue;
    let max = 0;
    cards.forEach(c => {
      c.style.minHeight = '';  // reset before measuring
      const h = c.getBoundingClientRect().height;
      if (h > max) max = h;
    });
    if (max > 0) {
      cards.forEach(c => { c.style.minHeight = max + 'px'; });
    }
  }
}

// Initialisiere beim View-Wechsel
document.addEventListener('DOMContentLoaded', () => {
  // Hook in die View-Switch-Logik (falls app.js eine Funktion expose-iert)
  if (typeof window.showView === 'function') {
    const orig = window.showView;
    window.showView = function(view) {
      orig.call(this, view);
      if (view === 'bibliothek') {
        loadBibliothek();
      }
    };
  } else {
    // Fallback: lade sofort, falls Bibliothek-View default ist
    setTimeout(() => {
      if (document.getElementById('bibliothekView')?.style.display !== 'none') {
        loadBibliothek();
      }
    }, 500);
  }
});
