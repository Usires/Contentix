// logs.js — Server-Log-View in den Settings
//
// Fetcht /api/logs, rendert die letzten N Zeilen, unterstützt:
//   - Filter nach Level (Alle / INFO / WARN / ERROR)
//   - Volltextsuche (case-insensitive)
//   - Auto-Refresh alle 10s (stoppt wenn Settings-Tab verlassen wird)
//   - Manuelle Aktualisierung per Button
//
// Aufbau: vanilla JS, kein Build-Step. Wird via <script>-Tag in index.html geladen.

(function() {
  'use strict';

  const REFRESH_MS = 10000;
  const DEFAULT_LINES = 200;

  let currentLevel = '';
  let currentSearch = '';
  let refreshTimer = null;
  let inFlight = false;

  function $(id) { return document.getElementById(id); }

  function getSelectedLevel() {
    const active = document.querySelector('#logsLevelChips .log-chip--active');
    return active ? active.dataset.level : '';
  }

  function getSearch() {
    const el = $('logsSearch');
    return el ? el.value.trim() : '';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight(line, search) {
    let html = escapeHtml(line);
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(safe, 'gi');
      html = html.replace(re, (m) => `<mark class="logs-mark">${escapeHtml(m)}</mark>`);
    }
    // Level-Tag einfärben
    html = html.replace(/\[(INFO|WARN|ERROR|DEBUG)\]/, (_, lvl) => {
      return `<span class="logs-level logs-level--${lvl.toLowerCase()}">[${lvl}]</span>`;
    });
    return html;
  }

  async function fetchLogs() {
    if (inFlight) return;
    inFlight = true;
    try {
      const params = new URLSearchParams();
      params.set('lines', String(DEFAULT_LINES));
      if (currentLevel) params.set('level', currentLevel);
      if (currentSearch) params.set('search', currentSearch);

      const res = await fetch('/api/logs?' + params.toString());
      if (!res.ok) {
        renderError(`HTTP ${res.status}: ${res.statusText}`);
        return;
      }
      const data = await res.json();
      render(data);
    } catch (err) {
      renderError(String(err));
    } finally {
      inFlight = false;
    }
  }

  function render(data) {
    const out = $('logsOutput');
    const meta = $('logsMeta');
    if (!out || !meta) return;
    if (!data.lines || data.lines.length === 0) {
      out.innerHTML = '<span class="logs-empty">(keine Zeilen passen zum Filter)</span>';
      meta.textContent = `0 von ${data.totalLines || 0} Zeilen, ${formatBytes(data.bytes || 0)}`;
      return;
    }
    const html = data.lines.map((l) => `<span class="logs-line">${highlight(l, currentSearch)}</span>`).join('\n');
    out.innerHTML = html;
    meta.textContent = `${data.returnedLines} von ${data.totalLines} Zeilen, ${formatBytes(data.bytes || 0)}`;
  }

  function renderError(msg) {
    const out = $('logsOutput');
    const meta = $('logsMeta');
    if (out) out.innerHTML = `<span class="logs-error">⚠️ ${escapeHtml(msg)}</span>`;
    if (meta) meta.textContent = 'Fehler beim Laden';
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function setActiveChip(level) {
    document.querySelectorAll('#logsLevelChips .log-chip').forEach((chip) => {
      chip.classList.toggle('log-chip--active', chip.dataset.level === level);
    });
    currentLevel = level;
  }

  function bindEvents() {
    document.querySelectorAll('#logsLevelChips .log-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        setActiveChip(chip.dataset.level);
        fetchLogs();
      });
    });
    const searchEl = $('logsSearch');
    if (searchEl) {
      let searchTimer = null;
      searchEl.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          currentSearch = getSearch();
          fetchLogs();
        }, 250);
      });
    }
    const btn = $('logsRefreshBtn');
    if (btn) btn.addEventListener('click', () => fetchLogs());
  }

  function startRefresh() {
    if (refreshTimer) return;
    fetchLogs();
    refreshTimer = setInterval(fetchLogs, REFRESH_MS);
  }

  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Wird vom Settings-Toggle aufgerufen (in app.js)
  window.ContentixLogs = {
    start: startRefresh,
    stop: stopRefresh,
    refresh: fetchLogs,
    isActive: () => refreshTimer !== null,
  };

  // Init beim DOM-Ready (Skript wird am Ende von <body> geladen)
  bindEvents();
})();
