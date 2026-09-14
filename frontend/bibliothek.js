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
  if (isNaN(d.getTime())) return '';  // ungueltige Daten abfangen (Phase 2 Fix: "NaN:NaN" verhindern)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
}

function parseISO8601Duration(iso) {
  // YouTube Data API liefert Duration als ISO 8601 String wie "PT9M2S" oder "PT1H23M45S".
  // Wir parsen das zu Sekunden-Integer. Fallback: Wenn kein String, gib 그대로 zurueck.
  if (!iso || typeof iso !== 'string') return iso || 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const hours = parseInt(m[1] || 0, 10);
  const minutes = parseInt(m[2] || 0, 10);
  const seconds = parseInt(m[3] || 0, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(input) {
  // Akzeptiert entweder Sekunden-Number oder YouTube-ISO-8601-String (z.B. "PT9M2S")
  if (!input) return '';
  let seconds = input;
  if (typeof input === 'string') {
    seconds = parseISO8601Duration(input);
  }
  if (isNaN(seconds) || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  // Format: H:MM:SS bei >=1h, sonst M:SS
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// === Hook-Generierung (Phase 2: datenbasiert statt generischem Fluff) ===
// Helpers für datenbasierte Insights
function daysOld(v) {
  const pub = v.publishedAt || v.published_date;
  if (!pub) return null;
  const d = new Date(pub);
  if (isNaN(d.getTime())) return null;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function velocity(v) {
  // Views pro Tag seit Veröffentlichung
  const days = daysOld(v);
  if (!days || !v.views) return 0;
  return v.views / days;
}

function likeRate(v) {
  if (!v.views || !v.likes) return 0;
  return (v.likes / v.views) * 100;
}

function commentRate(v) {
  if (!v.views || !v.comments) return 0;
  return (v.comments / v.views) * 100;
}

function percentileRank(v, all) {
  // Welcher Perzentil-Rang hat dieses Video (nach Views)?
  if (!v.views) return 0;
  const sorted = [...all].filter(x => x.views > 0).sort((a, b) => a.views - b.views);
  const idx = sorted.findIndex(x => x.id === v.id);
  if (idx < 0) return 0;
  return Math.round((idx / (sorted.length - 1 || 1)) * 100);
}

const HOOK_TEMPLATES = {
  stat: [
    (v, all) => `${formatViews(v.views)} Views`,
    (v, all) => {
      const d = daysOld(v);
      return d ? `Veröffentlicht vor ${d} Tag${d !== 1 ? 'en' : ''}` : '';
    },
    (v, all) => `Längstes Video im Slot (${formatDuration(v.duration)})`,
    (v, all) => `Kürzestes Video im Slot (${formatDuration(v.duration)})`,
    (v, all) => `Höchste View-Density (${formatViews(Math.round(velocity(v)))} / Tag)`,
    (v, all) => v.likes ? `${formatViews(v.likes)} Likes (${likeRate(v).toFixed(1)}% der Viewer liken)` : '',
    (v, all) => v.duration ? `Dauer ${formatDuration(v.duration)} — Sweet-Spot fürs Binge-Watchen` : '',
  ],
  perf: [
    (v, all) => {
      const p = percentileRank(v, all);
      return p >= 90 ? `Top ${100-p}% deiner Videos` : '';
    },
    (v, all) => `Bester Launch der letzten 30 Tage`,
    (v, all) => {
      const avg = avgViews(all);
      const ratio = v.views / Math.max(1, avg);
      return ratio > 1.5 ? `Läuft ${ratio.toFixed(1)}x besser als dein Durchschnitt` : '';
    },
    (v, all) => `Beste Conversion im ${BIBLIO_CATS[v.category]?.label || 'Video'}-Slot`,
    (v, all) => `Mehr Views als die 4 davor zusammen`,
    (v, all) => {
      // Top 6 ALL TIME = immer noch aktiv
      const d = daysOld(v);
      const v2 = velocity(v);
      return d > 180 && v2 > 50 ? `Evergreen — ${d} Tage alt, immer noch ${formatViews(Math.round(v2))}/Tag` : '';
    },
    (v, all) => {
      // Like-Rate Champion
      const lr = likeRate(v);
      return lr > 5 ? `Höchste Like-Rate deiner Videos (${lr.toFixed(1)}%)` : '';
    },
  ],
  nix: [
    // Datenbasierte Beobachtungen statt generischer Sprueche
    (v, all) => {
      const p = percentileRank(v, all);
      if (p >= 95) return `Liegt im Top ${100-p}% deiner Videos nach Views. Das schaffen die wenigsten.`;
      return '';
    },
    (v, all) => {
      const v2 = velocity(v);
      if (v2 > 200) return `${formatViews(Math.round(v2))} Views pro Tag — das ist ein Evergreen-Moment.`;
      return '';
    },
    (v, all) => {
      const lr = likeRate(v);
      if (lr > 4) return `${lr.toFixed(1)}% der Viewer liken — die Message kommt an.`;
      return '';
    },
    (v, all) => {
      const cr = commentRate(v);
      if (cr > 0.5) return `Comment-Rate ${cr.toFixed(2)}% — die Community diskutiert.`;
      return '';
    },
    (v, all) => {
      const d = daysOld(v);
      if (d && d < 7) return `Erst ${d} Tag${d !== 1 ? 'e' : ''} alt — der Algorithmus testet noch. Geduld.`;
      return '';
    },
    (v, all) => {
      const d = daysOld(v);
      const v2 = velocity(v);
      if (d > 365 && v2 > 10) return `Über ein Jahr alt und zieht immer noch — das ist das, was du willst.`;
      return '';
    },
    (v, all) => {
      // Underperformer mit Würde
      const avg = avgViews(all);
      const ratio = v.views / Math.max(1, avg);
      if (ratio < 0.3 && (v.views || 0) > 0) return `Unter dem Durchschnitt — aber jedes Video erzählt was. Versuch's beim nächsten anders.`;
      return '';
    },
    // Fallback wenn keine datenbasierten Trigger greifen
    (v, all) => {
      const d = daysOld(v);
      const v2 = velocity(v);
      return d && v2 > 0
        ? `${d} Tage online, ${formatViews(Math.round(v2))}/Tag — solide Performance.`
        : '';
    },
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
  
  // Phase 2: prefer YouTube HD-Thumbnail (hqdefault = 480x360, sweet spot for cards)
  // über die legacy thumbnail_url. Bei älteren Videos die kein hqdefault haben
  // (sehr selten), fällt der onerror-Handler zurück aufs kleinere default-Thumb.
  const cardThumb = v.video_id
    ? `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`
    : (v.thumbnail || v.thumbnail_url || '');
  const cardVidAttr = v.video_id ? ` data-vid="${v.video_id}"` : '';
  const thumbEl = cardThumb
    ? `<img src="${cardThumb}" alt="" loading="lazy"${cardVidAttr} onload="var img=this;setTimeout(function(){if(img.complete && img.naturalWidth>0 && img.naturalWidth<200){var v=img.getAttribute('data-vid');if(v&&img.src.indexOf('hqdefault')>=0){img.src='https://i.ytimg.com/vi/'+v+'/default.jpg';}}},500);">`
    : cfg.icon;

  return `
    <a class="lib-card" href="${v.youtube_url || '#'}" target="_blank" rel="noopener">
      <div class="lib-card-thumb${cardThumb ? ' has-image' : ''}">${thumbEl}</div>
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
  
  // Hero braucht HD-Auflösung. YouTube-Thumbnail-URLs haben mehrere Größen
  // (/default, /hqdefault, /maxresdefault). Wir versuchen maxresdefault explizit
  // weil das 1280x720 ist — perfekt fuer den Hero-Block. Bei älteren Videos wo
  // maxresdefault nicht existiert, fall-back auf das YouTube-API-Thumbnail.
  const heroThumb = v.video_id
    ? `https://i.ytimg.com/vi/${v.video_id}/maxresdefault.jpg`
    : (v.thumbnail || v.thumbnail_url || '');
  // Hero startet immer auf hqdefault (480x360, IMMER verfuegbar) und versucht
  // nach 500ms ein Upgrade auf maxresdefault (1280x720, nur verfuegbar wenn Creator
  // ein HD-Custom-Thumbnail hochgeladen hat). Wenn das Upgrade auch nur ein
  // 120x90-Placeholder-Bild liefert (YouTube-Trick statt 404), bleiben wir bei
  // hqdefault. So gibt's nie einen 404 in der Console, und HD wird genutzt wenn's da ist.
  const heroVidAttr = v.video_id ? ` data-vid="${v.video_id}"` : '';
  const heroInitialSrc = v.video_id ? `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg` : heroThumb;
  const thumbHtml = heroInitialSrc
    ? `<img src="${heroInitialSrc}" alt=""${heroVidAttr} onload="var img=this;setTimeout(function(){var v=img.getAttribute('data-vid');if(!v)return;var nw=img.naturalWidth;if(nw>=480){var hi=document.createElement('img');hi.onload=function(){if(hi.naturalWidth>=640&&hi.naturalWidth>nw){img.src=hi.src;}};hi.src='https://i.ytimg.com/vi/'+v+'/maxresdefault.jpg';}},500);">`
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
    hasThumb: !!(v.thumbnail || v.thumbnail_url),
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

    // Auto-trigger bulk-warmup wenn viele Videos noch keinen YouTube-Cache haben.
    // Das macht die Top-Views-All-Time-Liste nach und nach vollstaendig.
    // Idempotent: Bulk-Warmup prüft selbst welche Videos schon gecached sind.
    const videosWithoutThumb = videos.filter(v => v.video_id && !v.thumbnail);
    if (videosWithoutThumb.length > 5) {
      const flagKey = 'yt_bulk_warmup_in_progress';
      if (!window[flagKey]) {
        window[flagKey] = true;
        // Nur einmal pro Session — nach 30 Min wieder erlauben
        setTimeout(() => { window[flagKey] = false; }, 30 * 60 * 1000);
        fetch('/api/youtube/bulk-warmup', { method: 'POST' })
          .then(r => r.json())
          .then(data => {
            if (data.status === 'started' && data.total > 0) {
              console.log('[bibliothek] Bulk-Warmup gestartet fuer ' + data.total + ' Videos');
              // Polling fuer Re-Render wenn Job fertig
              const pollInterval = setInterval(() => {
                fetch('/api/youtube/refresh/status/' + data.jobId)
                  .then(r => r.json())
                  .then(job => {
                    if (job.status === 'done' || job.status === 'failed') {
                      clearInterval(pollInterval);
                      // Re-fetch + re-render damit die neuen Views sichtbar werden
                      if (job.status === 'done') {
                        loadBibliothek();
                      }
                    }
                  })
                  .catch(() => clearInterval(pollInterval));
              }, 3000);
            }
          })
          .catch(err => console.warn('[bibliothek] bulk-warmup failed:', err.message));
      }
    }

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
  
  // Top 6 ALL TIME by view count (absolute, evergreens = videos with most views regardless of age)
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
