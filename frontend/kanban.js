/* ==========================================================================
   CONTENTIX KANBAN BOARD — App JS
   Brainstorm Board — Nix & Dirk
   ========================================================================== */

// ─── State ──────────────────────────────────────────────────────────────────
let activeColumn = 'ideas';
let toastTimer = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('kanbanToast');
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = 'kanban-toast kanban-toast--' + type;
  void toast.offsetWidth;
  toast.classList.add('kanban-toast--visible');
  toastTimer = setTimeout(() => toast.classList.remove('kanban-toast--visible'), 3000);
}

// ─── Init ───────────────────────────────────────────────────────────────────
let kanbanStoreSubscribed = false;
document.addEventListener('DOMContentLoaded', () => {
  if (!kanbanStoreSubscribed) {
    kanbanStoreSubscribed = true;
    // Re-render whenever videos data changes. renderBoard() itself
    // no-ops when #kanbanBoard isn't in the DOM (board not yet created),
    // so we don't need a visibility check here. Visibility gating is
    // appropriate for scripts.js (where rendering is expensive) but
    // kanban's render is cheap and we need it to fire on first reveal.
    let lastHash = null;
    store.subscribe((state) => {
      const hash = JSON.stringify(state.videos);
      if (hash === lastHash) return;
      lastHash = hash;
      renderBoard();
    });
  }
  loadCards();
  setupDragAndDrop();
  setupModal();
  setupNav();
});

// ─── Load Cards from Backend ─────────────────────────────────────────────────
// Thin wrapper kept for callers (legacy / debug). Prefer store.actions.loadVideos().
async function loadCards() {
  try {
    await store.actions.loadVideos();
  } catch (err) {
    console.error('Fehler beim Laden:', err);
    renderBoard(); // Render empty board
  }
}

// ─── Store-bound selector ───────────────────────────────────────────────────
function getAllCards() {
  return store.select(s => s.videos);
}

// ─── Render Kanban Board ──────────────────────────────────────────────────────
const COLUMNS = [
  { id: 'ideas',     label: 'Ideen' },
  { id: 'research',  label: 'Recherche' },
  { id: 'skript',    label: 'Skript' },
  { id: 'recording', label: 'Recording' },
  { id: 'uploaded',  label: 'Hochgeladen' }
];

const STATUS_MAP = {
  draft:      'ideas',
  planned:    'ideas',
  research:   'research',
  script:     'skript',
  inprogress: 'skript',
  recording:  'recording',
  done:       'uploaded'
  // published → Calendar/Bibliothek only, NOT on the board
};

const STATUS_LABEL = {
  ideas:     'Idee',
  research:  'Recherche',
  skript:    'Skript',
  recording: 'Recording',
  uploaded: 'Uploaded'
};

function renderBoard() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const MAX_VISIBLE = 10;
  const allCards = getAllCards() || [];

  // Phase 1.2 v2: Vidi-Inbox als floating Panel (Modal-like) — kein Board-Spalte mehr.
  // Wenn Vidi installiert ist, rendern wir einen kleinen Toggle-Button links oben
  // (immer sichtbar auf dem Board) der ein floating Panel auf/abdeckt.
  // Das Panel ist NICHT im Grid-Layout, also kollidiert es nicht mit den 5 Standardsäulen.
  const vidiInstalled = typeof vidiIsInstalled === 'function' && vidiIsInstalled();
  const vidiInboxVisible = vidiInstalled && (localStorage.getItem('contentix.vidiInboxVisible') === '1');

  // Floating Panel: nur rendern wenn installed && visible. Position fixed-top-left,
  // 380px breit, bleibt sichtbar bis User es zumacht.
  // Body-Klasse für backdrop-dimming wenn offen.
  const vidiPanelHtml = (vidiInstalled && vidiInboxVisible) ? `
    <div id="vidiInboxPanel" class="vidi-panel" data-column="vidi-inbox">
      <div class="vidi-panel__header">
        <span class="vidi-panel__title">💡 Vidi-Inbox</span>
        <span class="vidi-panel__count" id="vidiInboxCount">…</span>
        <button class="vidi-panel__close" data-action="toggle-vidi-inbox" title="Vidi-Inbox schließen">✕</button>
      </div>
      <div class="vidi-panel__body" id="vidiInboxCards">
        <div class="board__empty">Lade Vorschläge…</div>
      </div>
    </div>
    <div class="vidi-panel-backdrop" data-action="toggle-vidi-inbox"></div>
  ` : '';

  // Toggle-Button: immer sichtbar wenn Vidi installiert (Default: zugeklappt).
  // Sitzt links oben im Board mit position:absolute. Klick öffnet Panel.
  const vidiToggleStub = vidiInstalled ? `
    <button class="vidi-toggle" data-action="toggle-vidi-inbox"
            title="Vidi-Inbox ${vidiInboxVisible ? 'schließen' : 'einblenden'} (${window.vidiStatus && window.vidiStatus.lastRun ? 'letzter Run ' + new Date(window.vidiStatus.lastRun).toLocaleString('de-DE') : 'cron-getriggert'})">
      <span class="vidi-toggle__icon">💡</span>
      <span class="vidi-toggle__text">Vidi-Inbox</span>
      <span class="vidi-toggle__count" id="vidiToggleCount">…</span>
    </button>
  ` : '';

  // Apply expanded class to board for layout-shift when Vidi-Inbox is visible.
  if (board) {
    board.classList.toggle('vidi-expanded', !!(vidiInstalled && vidiInboxVisible));
  }
  // Apply body class for backdrop when panel is visible
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle('vidi-panel-open', !!(vidiInstalled && vidiInboxVisible));
  }

  // Render standard columns (always).
  const standardColumns = COLUMNS.map(col => {
    const colCards = allCards.filter(c => STATUS_MAP[c.status] === col.id);

    return `
    <div class="board__column board__column--${col.id}" data-column="${col.id}">
      <div class="board__column-header">
        <span class="board__column-title">${col.label}</span>
        <span class="board__column-count">${colCards.length}</span>
      </div>
      <div class="board__cards" data-column="${col.id}">
        ${colCards.length === 0
          ? `<div class="board__empty">Notizzettel hierher…</div>`
          : colCards.map(c => renderCard(c)).join('')
        }
      </div>
      ${col.id !== 'uploaded' ? `
      <button class="board__add-card" data-column="${col.id}">
        <span>+</span> Content hinzufügen
      </button>` : ''}
    </div>`;
  }).join('');

  // Phase 1.2 v2: Toggle-Button SITZT im Board (oben-links), Panel ist floating
  // und wird in #vidiInboxPanelContainer (siehe unten) ausserhalb des Boards gerendert.
  board.innerHTML = vidiToggleStub + standardColumns;

  // Panel: in ein separates Container ausserhalb des Boards rendern, der im Layout
  // fixed-positioniert ist. So stört es das Board-Grid nicht.
  let panelContainer = document.getElementById('vidiInboxPanelContainer');
  if (!panelContainer) {
    panelContainer = document.createElement('div');
    panelContainer.id = 'vidiInboxPanelContainer';
    panelContainer.className = 'vidi-panel-container';
    // Vor #kanbanBoard einfügen, damit es im DOM vor dem Board ist
    const parent = board.parentNode;
    parent.insertBefore(panelContainer, board);
  }
  panelContainer.innerHTML = vidiPanelHtml;

  // Hook the Vidi-inbox refresh into the global so app.js can call it.
  window.refreshKanbanBoard = function () { renderBoard(); };

  setupDragAndDrop();
  setupCardListeners();

  // Fetch Vidi inbox items if panel is visible.
  if (vidiInstalled && vidiInboxVisible) {
    fetchAndRenderVidiInbox();
    // Drag-Handler braucht keinen Re-Bind hier: initVidiPanelDrag() IIFE (unten)
    // nutzt document-level delegated events die renderBoard() ueberleben.
  }
}

// Phase 1.2 v4: Vidi-Panel draggable — DOCUMENT-LEVEL delegated events.
// Wir installieren die Listener EINMAL beim Init auf `document`, nicht am panel.
// Dadurch ueberleben sie jeden renderBoard()-DOM-Replacement ohne Re-Bindung.
// Drag funktioniert sobald im DOM ein .vidi-panel mit .vidi-panel__header existiert.
(function initVidiPanelDrag() {
  if (window._vidiPanelDragInited) return;
  window._vidiPanelDragInited = true;

  function getPanelAndHeader() {
    const panel = document.getElementById('vidiInboxPanel');
    if (!panel) return null;
    const header = panel.querySelector('.vidi-panel__header');
    if (!header) return null;
    return { panel, header };
  }

  function shouldStartDrag(target) {
    if (!target) return false;
    if (target.closest('.vidi-panel__close')) return false;
    if (target.closest('.vidi-panel__count')) return false;
    // Nur wenn der Klick im Header-Bereich ist
    return !!target.closest('.vidi-panel__header');
  }

  function applyDrag(panel, anchorX, anchorY, clientX, clientY) {
    // Phase 1.2 v5 Bug-Fix: direkte top/left-Inline-Styles statt CSS-Custom-Properties.
    // Vermeidet calc()+var()-Layer-Verzögerungen die Drag-Jumps verursachen.
    // Anchor (relativer Maus-Versatz zum Panel-TopLeft) + neue Maus-Position = neue Position.
    let newTop = clientY - anchorY;
    let newLeft = clientX - anchorX;
    // Bounds: Panel muss mindestens 100px breit und 60px hoch im Viewport sichtbar bleiben.
    const minVisible = 100;
    const minVisibleV = 60;
    newTop = Math.max(10, Math.min(newTop, window.innerHeight - minVisibleV));
    newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - minVisible));
    panel.style.top = newTop + 'px';
    panel.style.left = newLeft + 'px';
    return { offX: newLeft, offY: newTop };
  }

  // Mouse drag (desktop).
  document.addEventListener('mousedown', (e) => {
    const refs = getPanelAndHeader();
    if (!refs) return;
    if (!shouldStartDrag(e.target)) return;
    e.preventDefault();
    const { panel } = refs;
    panel.classList.add('is-dragging');
    const rect = panel.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;

    const onMove = (mv) => {
      mv.preventDefault();
      applyDrag(panel, anchorX, anchorY, mv.clientX, mv.clientY);
    };
    const onUp = () => {
      panel.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        // Phase 1.2 v5: persist via style.top/left (raw px values), nicht via CSS-Custom-Property.
        // Wir speichern die Differenz zur Default-Position (12, 70) als relative Koordinaten.
        const curTop = parseInt(panel.style.top || '70', 10);
        const curLeft = parseInt(panel.style.left || '12', 10);
        localStorage.setItem('contentix.vidiPanelX', (curLeft - 12) + 'px');
        localStorage.setItem('contentix.vidiPanelY', (curTop - 70) + 'px');
      } catch (e) {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch drag (mobile/tablet).
  document.addEventListener('touchstart', (e) => {
    const refs = getPanelAndHeader();
    if (!refs) return;
    if (e.touches.length !== 1) return;
    if (!shouldStartDrag(e.target)) return;
    const touch = e.touches[0];
    const { panel } = refs;
    panel.classList.add('is-dragging');
    const rect = panel.getBoundingClientRect();
    const anchorX = touch.clientX - rect.left;
    const anchorY = touch.clientY - rect.top;

    const onMove = (mv) => {
      if (mv.touches.length !== 1) return;
      mv.preventDefault();
      const ct = mv.touches[0];
      applyDrag(panel, anchorX, anchorY, ct.clientX, ct.clientY);
    };
    const onEnd = () => {
      panel.classList.remove('is-dragging');
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      try {
        // Phase 1.2 v5: persist via style.top/left (raw px values).
        const curTop = parseInt(panel.style.top || '70', 10);
        const curLeft = parseInt(panel.style.left || '12', 10);
        localStorage.setItem('contentix.vidiPanelX', (curLeft - 12) + 'px');
        localStorage.setItem('contentix.vidiPanelY', (curTop - 70) + 'px');
      } catch (e) {}
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, { passive: true });

  // Restore panel position once on init.
  try {
    const x = parseInt(localStorage.getItem('contentix.vidiPanelX') || '0', 10);
    const y = parseInt(localStorage.getItem('contentix.vidiPanelY') || '0', 10);
    // Apply to any panel that exists now + to documentElement defaults for future open()s.
    const panel = document.getElementById('vidiInboxPanel');
    if (panel) {
      panel.style.top = (70 + y) + 'px';
      panel.style.left = (12 + x) + 'px';
    }
  } catch (e) {}
})();

// Reset-Helper for debugging via Console: window.resetVidiPanelPosition().
window.resetVidiPanelPosition = function () {
  try {
    localStorage.removeItem('contentix.vidiPanelX');
    localStorage.removeItem('contentix.vidiPanelY');
    console.log('[Vidi] Panel-Position zurueckgesetzt. Browser-Reload noetig.');
  } catch (e) {}
};

// Phase 1.2: Toggle Vidi-Inbox visibility (localStorage-persisted).
// Called from the ✕-button on the lane OR from the stub button.
window.toggleVidiInbox = function () {
  const current = localStorage.getItem('contentix.vidiInboxVisible') === '1';
  localStorage.setItem('contentix.vidiInboxVisible', current ? '0' : '1');
  // Re-render without re-fetching everything.
  if (typeof window.refreshKanbanBoard === 'function') {
    window.refreshKanbanBoard();
  }
};

// Phase 1.2: Vidi-Inbox items aus /api/vidi/inbox fetchen und rendern.
async function fetchAndRenderVidiInbox() {
  const container = document.getElementById('vidiInboxCards');
  const counter = document.getElementById('vidiInboxCount');
  if (!container) return;

  try {
    const res = await fetch(`${API}/vidi/inbox?status=inbox&limit=10`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (counter) counter.textContent = items.length;

    if (!items.length) {
      container.innerHTML = `<div class="board__empty">Keine Vorschläge. Vidi läuft per Cron (09:00).</div>`;
      return;
    }

    container.innerHTML = items.map(renderVidiSuggestionCard).join('');
    setupVidiSuggestionListeners();
  } catch (e) {
    container.innerHTML = `<div class="board__empty board__empty--error">Vidi-Inbox nicht ladbar: ${e.message}</div>`;
  }
}

// Phase 1.2: Render single Vidi-suggestion card.
function renderVidiSuggestionCard(item) {
  const score = (item.confidence_score || 0).toFixed(2);
  const source = item.source || 'vidi';
  const channelBadge = item.target_channel_id ? `<span class="kanban-vidi__channel-badge">${escapeHtml(item.target_channel_id)}</span>` : '';
  return `
    <div class="kanban-vidi" data-id="${item.id}">
      <div class="kanban-vidi__header">
        <span class="kanban-vidi__source">${escapeHtml(source)}</span>
        <span class="kanban-vidi__score">Score ${score}</span>
      </div>
      <div class="kanban-vidi__title">${escapeHtml(item.title || '(ohne Titel)')}</div>
      ${item.hook_line ? `<div class="kanban-vidi__hook">${escapeHtml(item.hook_line)}</div>` : ''}
      ${item.why_now ? `<details class="kanban-vidi__why"><summary>Warum jetzt?</summary>${escapeHtml(item.why_now)}</details>` : ''}
      ${item.script_skeleton ? `<details class="kanban-vidi__skel"><summary>Script-Skelett</summary><pre class="kanban-vidi__skel-pre">${escapeHtml(item.script_skeleton)}</pre></details>` : ''}
      ${channelBadge}
      <div class="kanban-vidi__actions">
        <button class="btn btn--primary btn--small" data-vidi-action="approve" data-id="${item.id}">→ Approve (Research)</button>
        <button class="btn btn--secondary btn--small" data-vidi-action="reject" data-id="${item.id}">✕ Reject</button>
      </div>
    </div>
  `;
}

// Phase 1.2: Approve/Reject click handlers.
function setupVidiSuggestionListeners() {
  document.querySelectorAll('[data-vidi-action]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.vidiAction;
      try {
        const res = await fetch(`${API}/vidi/inbox/${id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'dirk' }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'unknown' }));
          showToast(`Vidi-${action} fehlgeschlagen: ${err.error || res.status}`, 'error');
          return;
        }
        showToast(action === 'approve' ? '✅ Vidi-Vorschlag approved — in Research-Lane' : '✓ Vidi-Vorschlag rejected', 'info');
        fetchAndRenderVidiInbox();  // refresh
        if (action === 'approve') loadContent(); // re-render kanban so new video shows
      } catch (e) {
        showToast(`Vidi-${action} Fehler: ${e.message}`, 'error');
      }
    });
  });
}

// ─── Render Single Card ────────────────────────────────────────────────────────
function formatDateTTMM(isoDate) {
  // isoDate like "2026-06-15" or "2026-06-15T10:00:00" → "15.06."
  const datePart = (isoDate || '').split('T')[0] || '';
  if (!datePart || datePart.length < 10) return isoDate || 'Ungeplant';
  return `${datePart.substring(8, 10)}.${datePart.substring(5, 7)}.`;
}

function renderCard(card) {
  const isNix = (card.owner || 'dirk') === 'nix';
  const authorIcon = isNix ? '🐧' : '🎬';
  const authorName = isNix ? 'Nix' : 'Dirk';
  const hasResearch = card.nix_comment && card.nix_comment.trim();
  const isPublishedWithThumb = card.status === 'done' && card.thumbnail_url;

  return `
  <div class="kanban-card" data-id="${card.id}" draggable="true">
    ${isPublishedWithThumb ? `<img src="${escapeHtml(card.thumbnail_url)}" class="kanban-card__thumb" alt="Thumbnail" loading="lazy">` : ''}
    <div class="kanban-card__title">${escapeHtml(card.title)}</div>
    <div class="kanban-card__author">
      <span class="kanban-card__author-icon">${authorIcon}</span>
      <span class="kanban-card__author-name">${authorName}</span>
    </div>
    <div class="kanban-card__date-row">
      ${card.planned_date
        ? `📅 ${formatDateTTMM(card.planned_date)}`
        : `<span class="kanban-card__date-row--unset">📅 Ungeplant</span>`}
    </div>
    <div class="kanban-card__meta">
      ${card.tags ? card.tags.slice(0, 3).map(t =>
        `<span class="kanban-card__tag">${escapeHtml(t)}</span>`
      ).join('') : ''}
    </div>
    ${card.notes ? `<div class="kanban-card__notes">${escapeHtml(card.notes)}</div>` : ''}
    ${hasResearch ? `<div class="nix-research">
      <div class="nix-research__header">Vidi 🔭 sagt:</div>
      <div class="nix-research__text">${escapeHtml(truncate(card.nix_comment, 120))}</div>
    </div>` : ''}
    <div class="kanban-card__footer">
      <div class="kanban-card__actions">
        <button class="kanban-card__action" data-action="edit" data-id="${card.id}" title="Bearbeiten">Bearbeiten</button>
        ${['planned','research','script'].includes(card.status) ? `<button class="kanban-card__action kanban-card__action--nix" data-action="nix-research" data-id="${card.id}" title="Vidi 🔭 Research starten">🔭 Vidi</button>` : ''}
        <button class="kanban-card__action" data-action="delete" data-id="${card.id}" title="Löschen">Löschen</button>
      </div>
    </div>
  </div>`;
}

// ─── Drag & Drop ───────────────────────────────────────────────────────────────
function setupDragAndDrop() {
  document.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  document.querySelectorAll('.board__cards').forEach(col => {
    col.addEventListener('dragover', handleDragOver);
    col.addEventListener('drop', handleDrop);
    col.addEventListener('dragleave', handleDragLeave);
  });
}

let draggedCard = null;
let draggedFromColumn = null;

function handleDragStart(e) {
  draggedCard = e.target.closest('.kanban-card');
  draggedFromColumn = draggedCard.parentElement.dataset.column;
  draggedCard.classList.add('kanban-card--dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  if (draggedCard) {
    draggedCard.classList.remove('kanban-card--dragging');
  }
  document.querySelectorAll('.board__cards').forEach(c => c.classList.remove('board__cards--drop-target'));
  draggedCard = null;
  draggedFromColumn = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.target.closest('.board__cards');
  if (col) col.classList.add('board__cards--drop-target');
}

function handleDragLeave(e) {
  const col = e.target.closest('.board__cards');
  if (col && !col.contains(e.relatedTarget)) {
    col.classList.remove('board__cards--drop-target');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const col = e.target.closest('.board__cards');
  if (!col || !draggedCard) return;
  col.classList.remove('board__cards--drop-target');

  const toColumn = col.dataset.column;
  const cardId = draggedCard.dataset.id;

  if (draggedFromColumn === toColumn) return;

  // Map column to video status
  const reverseStatusMap = {
    ideas:     'planned',
    research:  'research',
    skript:    'script',
    recording: 'recording',
    uploaded:  'done',
    archived:  'planned'
  };

  try {
    await store.actions.updateVideo(cardId, { status: reverseStatusMap[toColumn] });
    // Subscribe-with-hash will trigger renderBoard automatically.
    if (toColumn === 'uploaded' && typeof confettiAtColumn === 'function') {
      confettiAtColumn('uploaded');
      setTimeout(() => confettiAtColumn('uploaded'), 350);
      setTimeout(() => confettiAtColumn('uploaded'), 700);
    }
    if (typeof updateNextVideo === 'function') updateNextVideo();
  } catch (err) {
    showToast('Fehler beim Verschieben: ' + err.message, 'error');
  }
}

// ─── Card Action Listeners (event delegation) ────────────────────────────────
function setupCardListeners() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  // Phase 1.2 Bug-Fix: Use a single delegated click listener on the board
  // (parent of all dynamic columns). This survives re-renders because
  // innerHTML-replacement doesn't affect listeners on PARENT elements.
  // The old code added listeners to .kanban-card__action elements directly,
  // which got wiped on every renderBoard().
  board.addEventListener('click', async (e) => {
    // Vidi-Inbox toggle (✕-button on lane OR stub-button).
    // Intercept FIRST so toggle-buttons (which live in column headers,
    // not in kanban-cards) don't get eaten by the kanban-card handler.
    const vidiToggleBtn = e.target.closest('[data-action="toggle-vidi-inbox"]');
    if (vidiToggleBtn) {
      if (typeof window.toggleVidiInbox === 'function') {
        window.toggleVidiInbox();
      }
      return;
    }

    const btn = e.target.closest('.kanban-card__action');
    if (!btn) {
      // Card body click → open modal (but not button clicks)
      const card = e.target.closest('.kanban-card');
      if (card && !e.target.closest('button') && !e.target.closest('a')) {
        const cardId = card.dataset.id;
        if (cardId) openCardModal(cardId);
      }
      return;
    }

    const action = btn.dataset.action;
    const cardId = btn.dataset.id;
    e.stopPropagation();

    if (action === 'edit') {
      openCardModal(cardId);
    } else if (action === 'delete') {
      showConfirm('Diese Karte wirklich löschen?', async () => {
        await deleteCard(cardId);
      });
    } else if (action === 'archive') {
      await archiveCard(cardId);
    } else if (action === 'nix-research') {
      await triggerNixResearch(cardId);
    }
  });

  // Add card buttons (static, so separate is fine)
  document.querySelectorAll('.board__add-card').forEach(btn => {
    btn.addEventListener('click', () => {
      openCardModal(null, btn.dataset.column);
    });
  });
}

// ─── Card Actions ───────────────────────────────────────────────────────────
async function deleteCard(cardId) {
  try {
    await store.actions.deleteVideo(cardId);
    showToast('Karte gelöscht', 'success');
  } catch (err) {
    showToast('Fehler beim Löschen: ' + err.message, 'error');
  }
}

async function archiveCard(cardId) {
  try {
    await store.actions.updateVideo(cardId, { status: 'archived' });
    showToast('Karte archiviert', 'success');
  } catch (err) {
    showToast('Fehler beim Archivieren: ' + err.message, 'error');
  }
}

// Set von Cards, für die gerade ein Research-Job läuft. Cooldown-Schutz gegen Doppel-Trigger.
const _runningResearchJobs = new Set();

async function triggerNixResearch(cardId) {
  // 1) Client-side Cooldown: kein zweiter Trigger während der erste noch läuft
  if (_runningResearchJobs.has(cardId)) {
    showToast('🔭 Vidi läuft schon für diese Karte…', 3000);
    return;
  }
  _runningResearchJobs.add(cardId);
  let toastId;
  try {
    // 2) Job triggern (Vidi 🔭, nutzt YouTube Data API, ca. 1–3 Min)
    const res = await fetch(`${API}/research/${cardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'youtubebot' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const { jobId } = await res.json();
    toastId = showToast(`🔭 Vidi forscht… (Job ${jobId.slice(0,8)}…)`, 0);

    // 3) Polling alle 2s, max 5 Min
    const result = await pollResearchJob(jobId);
    if (toastId) hideToast();

    // 4) Result anzeigen
    if (result.status === 'done') {
      const text = result.result?.text || '(kein Text)';
      showResearchResultModal(cardId, text, result);
      showToast('✅ Vidi fertig!', 3000);
    } else if (result.status === 'error') {
      showToast(`❌ Vidi-Fehler: ${result.error || 'unbekannt'}`, 8000);
    } else if (result.status === 'cancelled') {
      showToast('⏹️ Vidi-Job abgebrochen', 3000);
    }
  } catch (err) {
    if (toastId) hideToast();
    showToast('Fehler: ' + err.message, 5000);
    console.error('[triggerNixResearch]', err);
  } finally {
    _runningResearchJobs.delete(cardId);
  }
}

// Polling-Helper: ruft /api/research/:jobId alle 2s, gibt finalen Status zurück.
async function pollResearchJob(jobId, { intervalMs = 2000, timeoutMs = 300000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastProgress = '';
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/research/${jobId}`);
    if (!res.ok) throw new Error(`Polling HTTP ${res.status}`);
    const job = await res.json();
    // Sub-Progress: Update-Tooltip + Toast wenn sich was ändert
    if (job.progressMessage && job.progressMessage !== lastProgress) {
      lastProgress = job.progressMessage;
      // Toast updaten (nur Text), kein neues Popup
      const toast = document.getElementById('kanbanToast');
      if (toast && toast.classList.contains('kanban-toast--visible')) {
        toast.textContent = `🔭 Vidi forscht… ${lastProgress}`;
      }
    }
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return job;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Vidi-Job Timeout (5 Min) — schau in /api/research/' + jobId);
}

// Modal mit Vidis Research-Report. Verwendet App-Modal-Pattern (.modal > .modal__backdrop + .modal__box).
function showResearchResultModal(cardId, text, job) {
  const modal = document.createElement('div');
  modal.className = 'modal modal--research';
  modal.innerHTML = `
    <div class="modal__backdrop"></div>
    <div class="modal__box modal__box--wide">
      <div class="modal__header">
        <h3 class="modal__title">🔭 Vidi Research-Report</h3>
        <button class="modal__close" aria-label="Schließen">×</button>
      </div>
      <div class="modal__body modal__body--report">
        <div class="research-meta">
          Job <code>${job.jobId.slice(0,8)}…</code> · ${new Date(job.finishedAt).toLocaleString('de-DE')} · ${job.result?.summary || ''}
        </div>
        <div class="markdown-body">${DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true, headerIds: false, mangle: false }))}</div>
      </div>
      <div class="modal__footer modal__footer--actions">
        <button class="btn btn--secondary" data-action="close">Schließen</button>
        <button class="btn btn--primary" data-action="open-card">Karte öffnen</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => {
    modal.remove();
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  modal.querySelector('.modal__close').onclick = close;
  modal.querySelector('[data-action="close"]').onclick = close;
  modal.querySelector('[data-action="open-card"]').onclick = () => { close(); openCardModal(cardId); };
  modal.querySelector('.modal__backdrop').onclick = close;
  // Focus auf Close-Button (Accessibility + ESC-Fokus-Konvention)
  setTimeout(() => {
    if (modal.isConnected) modal.querySelector('.modal__close')?.focus();
  }, 50);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function duplicateCard(cardId) {
  const card = getAllCards().find(c => c.id === cardId);
  if (!card) return;
  try {
    await store.actions.createVideo({
      title: card.title + ' (Kopie)',
      status: card.status,
      planned_date: card.planned_date || null,
      thumbnail: card.thumbnail || null,
      notes: card.notes || '',
      video_format: card.video_format || 'standard'
    });
    showToast('Karte dupliziert', 'success');
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function setupModal() {
  // Backdrop click closes modal
  document.getElementById('kanbanModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'kanbanModal' || e.target.classList.contains('kanban-modal__backdrop')) {
      closeCardModal();
    }
  });
  document.getElementById('kanbanModalClose')?.addEventListener('click', closeCardModal);
  document.getElementById('kanbanForm')?.addEventListener('submit', handleCardSubmit);
  document.getElementById('kanbanCancel')?.addEventListener('click', closeCardModal);

  // Status selector buttons
  document.querySelectorAll('.status-selector__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-selector__btn').forEach(b => b.classList.remove('status-selector__btn--active'));
      btn.classList.add('status-selector__btn--active');
    });
  });
}

let _confirmCallback = null;
let _confirmFormHTML = null;

function showConfirm(message, onConfirm) {
  const modal = document.getElementById('kanbanModal');
  const title = document.getElementById('kanbanModalTitle');
  const form = document.getElementById('kanbanForm');

  _confirmCallback = onConfirm;
  title.textContent = message;
  form.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
      <button type="button" class="btn btn--secondary" id="confirmCancel">Abbrechen</button>
      <button type="button" class="btn btn--danger" id="confirmOk">Löschen</button>
    </div>`;
  document.getElementById('confirmCancel').addEventListener('click', closeCardModal);
  document.getElementById('confirmOk').addEventListener('click', () => {
    closeCardModal();
    if (_confirmCallback) _confirmCallback();
  });
  modal.style.display = 'flex';
}

// ─── Status Pipeline ───────────────────────────────────────────────────
// Interactive 5-step progress bar used in the card modal.
// Works for both edit and new-card modes: click any step to set status.
const PIPELINE_STEPS = ['ideas', 'research', 'skript', 'recording', 'uploaded'];

// ─── Modal Helpers ───────────────────────────────────────────────────
// (focusFirstField is in utils.js — loaded first, available globally)

function setupStatusPipeline(activeIdx) {
  // Clean previous click handlers (clone-replace pattern) so we don't accumulate listeners
  const pipelineSteps = document.querySelectorAll('.status-pipeline__step');
  pipelineSteps.forEach(step => {
    const clone = step.cloneNode(true);
    step.parentNode.replaceChild(clone, step);
  });

  // Re-query after clone
  document.querySelectorAll('.status-pipeline__step').forEach((el, i) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const form = document.getElementById('kanbanForm');
      if (form) form.status.value = PIPELINE_STEPS[i];
      const allSteps = document.querySelectorAll('.status-pipeline__step');
      allSteps.forEach((s, j) => {
        s.classList.remove('is-done', 'is-active');
        if (j < i) s.classList.add('is-done');
        else if (j === i) s.classList.add('is-active');
      });
      const fillPct = PIPELINE_STEPS.length > 1
        ? (i / (PIPELINE_STEPS.length - 1)) * 100
        : 0;
      document.getElementById('statusPipelineBarFill').style.width = fillPct + '%';
    });
  });

  // Apply current active state without firing a click event
  document.querySelectorAll('.status-pipeline__step').forEach((el, i) => {
    el.classList.remove('is-done', 'is-active');
    if (i < activeIdx) el.classList.add('is-done');
    else if (i === activeIdx) el.classList.add('is-active');
  });
  const fillPct = PIPELINE_STEPS.length > 1
    ? (activeIdx / (PIPELINE_STEPS.length - 1)) * 100
    : 0;
  document.getElementById('statusPipelineBarFill').style.width = fillPct + '%';
}

async function populateRemakeDropdown(currentCardId) {
  const sel = document.getElementById('remakeLinkSelect');
  if (!sel) return;
  try {
    // Read videos from the central store (ADR-001 Phase 3).
    // If the store is empty, trigger a load first so the dropdown has data.
    let all = getAllCards();
    if (all.length === 0) {
      await store.actions.loadVideos();
      all = getAllCards();
    }
    const originals = all.filter(v => !v.parent_video_id || v.id === currentCardId);

    // Sort by published_date DESC (published first), then by created_at DESC
    originals.sort((a, b) => {
      const da = a.published_date || a.created_at || '';
      const db = b.published_date || b.created_at || '';
      return db.localeCompare(da);
    });

    sel.innerHTML = '<option value="">— Kein Remake —</option>' +
      originals.map(v => {
        const date = v.published_date ? new Date(v.published_date).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit' }) : (v.created_at ? new Date(v.created_at).toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit' }) : '');
        const label = `${v.title}${date ? ` (${date})` : ''}`;
        return `<option value="${v.id}">${escapeHtml(label)}</option>`;
      }).join('');

    // If editing, set the current value
    if (currentCardId) {
      const card = all.find(c => c.id === currentCardId);
      if (card && card.parent_video_id) {
        sel.value = card.parent_video_id;
      }
    }
  } catch (err) {
    console.error('populateRemakeDropdown failed:', err);
  }
}

function openCardModal(cardId = null, defaultColumn = 'ideas', prefillDate = null) {
  const modal = document.getElementById('kanbanModal');
  const form = document.getElementById('kanbanForm');
  const modalTitle = document.getElementById('kanbanModalTitle');
  form.reset();

  // Populate remake dropdown (only originals: parent_video_id IS NULL or self)
  populateRemakeDropdown(cardId);

  // Set modal title based on mode
  if (modalTitle) {
    modalTitle.textContent = cardId ? 'Karte bearbeiten' : 'Neue Karte erstellen';
  }

  // Reset script link display
  const slg = document.getElementById('scriptLinkGroup');
  if (slg) slg.style.display = 'none';

  if (cardId) {
    const card = getAllCards().find(c => c.id === cardId);
    if (card) {
      form.title.value = card.title || '';
      form.notes.value = card.notes || '';
      form.tags.value = card.tags ? card.tags.join(', ') : '';
      form.owner.value = card.owner || 'dirk';
      form.youtube_url.value = card.youtube_url || '';
      if (prefillDate) {
        // Use new date from calendar drag-drop, keep original time
        const [newDatePart, newTimePart] = prefillDate.split('T');
        const [origDatePart, origTimePart] = (card.planned_date || '').split('T');
        form.planned_date.value = newDatePart || '';
        form.planned_time.value = origTimePart || newTimePart || '';
      } else if (card.planned_date) {
        const [datePart, timePart] = card.planned_date.split('T');
        form.planned_date.value = datePart || '';
        form.planned_time.value = timePart ? timePart.substring(0, 5) : '';
      } else {
        form.planned_date.value = '';
        form.planned_time.value = '';
      }
      // Show status pipeline (interactive in edit mode too)
      const col = STATUS_MAP[card.status] || 'ideas';
      const activeIdx = PIPELINE_STEPS.indexOf(col);
      setupStatusPipeline(activeIdx);
      form.dataset.editId = cardId;
      form.status.value = col; // Hidden input for handleCardSubmit

      // Show delete button only for manually created cards (not YouTube-synced entries)
      const deleteBtn = document.getElementById('kanbanDeleteBtn');
      if (deleteBtn) deleteBtn.style.display = (!card.video_id) ? 'inline-block' : 'none';

      // Show linked script if any
      if (card.script_id) {
        fetch(`${API}/scripts/${card.script_id}`)
          .then(r => r.ok ? r.json() : null)
          .then(script => {
            if (script) {
              document.getElementById('scriptLinkInfo').textContent = `✏️ ${script.title}`;
              const slg = document.getElementById('scriptLinkGroup');
              if (slg) slg.style.display = 'block';
            }
          })
          .catch(() => {});
      }
    }
  } else {
    delete form.dataset.editId;
    // Store the column for new card creation (used in handleCardSubmit)
    form.dataset.column = defaultColumn;
    form.status.value = defaultColumn;
    setupStatusPipeline(0); // start at first step
    // Show/hide delete button depending on whether we're editing
    const deleteBtn = document.getElementById('kanbanDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  document.getElementById('kanbanModal').style.display = 'flex';
  document.body.classList.add('modal-open');
  focusFirstField('kanbanModal');
}

function closeCardModal() {
  document.getElementById('kanbanModal').style.display = 'none';
  document.body.classList.remove('modal-open');
  if (_confirmFormHTML) {
    document.getElementById('kanbanForm').innerHTML = _confirmFormHTML;
    _confirmFormHTML = null;
    // Rebind form events after restore
    document.getElementById('kanbanForm')?.addEventListener('submit', handleCardSubmit);
    document.getElementById('kanbanCancel')?.addEventListener('click', closeCardModal);
    document.querySelectorAll('.status-selector__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.status-selector__btn').forEach(b => b.classList.remove('status-selector__btn--active'));
        btn.classList.add('status-selector__btn--active');
      });
    });
  }
}

async function handleCardSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.editId;

  // Use the stored column (from "+ Content hinzufügen" click) for new cards,
  // or the active status button for existing cards being edited
  const col = id ? (form.status.value) : (form.dataset.column || 'ideas');

  const reverseStatusMap = {
    ideas:     'planned',
    research:  'research',
    skript:    'script',
    recording: 'recording',
    uploaded:  'done'
  };

  const payload = {
    title: form.title.value,
    notes: form.notes.value,
    tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
    status: reverseStatusMap[col] || 'planned',
    owner: form.owner?.value || 'dirk',
    youtube_url: form.youtube_url ? form.youtube_url.value : undefined,
    planned_date: form.planned_date?.value ? (form.planned_time?.value ? form.planned_date.value + 'T' + form.planned_time.value + ':00' : form.planned_date.value) : null,
    parent_video_id: form.parent_video_id && form.parent_video_id.value ? form.parent_video_id.value : null
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  const origBtnText = submitBtn ? submitBtn.textContent : '';
  try {
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '💾 Speichern...'; }
    if (id) {
      await store.actions.updateVideo(id, payload);
    } else {
      await store.actions.createVideo(payload);
    }
    showToast('✓ Gespeichert', 'success');
    closeCardModal();
    // Subscribers re-render the board automatically. Calendar also
    // re-renders because it subscribes to the same store.
    if (typeof updateNextVideo === 'function') updateNextVideo();
  } catch (err) {
    showToast('Fehler: ' + err.message, 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origBtnText; }
  }
}

// Called from the Löschen button inside the modal
async function deleteFromModal() {
  const form = document.getElementById('kanbanForm');
  const cardId = form.dataset.editId;
  if (!cardId) return;
  closeCardModal();
  await deleteCard(cardId);
}

// saveCard was moved to handleCardSubmit
