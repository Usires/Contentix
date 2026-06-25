// ─── Contentix Script Editor (JSTree-powered) ──────────────────────────────
// API defined in app.js

// ─── State ─────────────────────────────────────────────────────────────────
// `getAllScripts()` and `getActiveScript()` migrated to the central store (ADR-001).
// Reads via store.select(...), writes via store.actions.*.
// Locals: autoSaveTimer/isDirty/jsTreeInstance stay here — view-local state.
let autoSaveTimer = null;
let isDirty = false;
let jsTreeInstance = null;

// Default folders — order matters (Archiv always last, collapsed by default)
const DEFAULT_FOLDERS = ['scripts', 'Entwürfe', 'channel', 'resources', 'Archiv'];
const ARCHIV_FOLDER = 'Archiv';
const TREE_STATE_KEY = 'contentix.scripts.treeState';
const TREE_SEARCH_KEY = 'contentix.scripts.lastSearch';
const TREE_WIDTH_KEY = 'contentix.scripts.sidebarWidth';

// ─── Store-bound selectors ─────────────────────────────────────────────────
// Use these instead of touching a top-level `getAllScripts()` / `getActiveScript()`.
// Keep them tiny — they're the only places that know the state shape.

function getAllScripts() {
  return store.select(s => s.scripts);
}
function getActiveScript() {
  return store.select(s => {
    const id = s.ui.activeScriptId;
    return id ? s.scripts.find(x => x.id === id) || null : null;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
let scriptsStoreSubscribed = false;
async function initScripts() {
  if (!scriptsStoreSubscribed) {
    scriptsStoreSubscribed = true;
    // Re-render the tree ONLY when the scripts data itself changes.
    // We deliberately ignore ui-only state changes (activeScriptId,
    // activeView) here because those don't affect the tree data —
    // handling them in renderScriptsView would tear down jsTreeInstance
    // mid-click, causing jstree's internal handler to call
    // triggerHandler() on the destroyed instance.
    //
    // Comparison strategy: hash the scripts array; render only on change.
    // Cheap enough at our scale (~hundreds of scripts).
    let lastScriptsHash = null;
    store.subscribe((state) => {
      const container = document.getElementById('scriptsContainer');
      if (!container || container.offsetParent === null) return;
      const hash = JSON.stringify(state.scripts);
      if (hash === lastScriptsHash) return;
      lastScriptsHash = hash;
      renderScriptsView();
    });
  }
  await loadVideosForLink();
  await store.actions.loadScripts();
  // loadScripts fires its own subscribers; the subscription above handles it.
}

// ─── Load ─────────────────────────────────────────────────────────────────
// Kept as a thin wrapper for callers (some legacy code may still call
// scripts.js loadScripts). Prefer store.actions.loadScripts() directly.
async function loadScripts() {
  const container = document.getElementById('scriptsContainer');
  if (!container) return;
  try {
    await store.actions.loadScripts();
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
      <div class="scripts-list-panel" id="scriptsListPanel">
        <div class="scripts-list-header">
          <h2>📂 Skripte</h2>
          <div class="scripts-list-header-actions">
            <button class="btn-icon" id="btnNewScript" title="Neues Skript in aktuellem Folder" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(42,32,48,0.15);background:#7c5cbf;color:#fff;cursor:pointer;font-size:14px;">+</button>
            <button class="btn-icon" id="btnNewFolder" title="Neuer Folder" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(42,32,48,0.15);background:transparent;color:#2a2030;cursor:pointer;font-size:14px;">📁</button>
          </div>
        </div>
        <div class="scripts-search">
          <input type="text" id="scriptSearchInput" placeholder="🔍 Suchen…" />
        </div>
        <div class="scripts-tree" id="scriptsTree"></div>
        <div class="scripts-status-legend" id="scriptsStatusLegend">
          <div class="status-legend-title">Legende</div>
          <div class="status-legend-row"><span class="status-legend-icon">⚪</span><span class="status-legend-label">Draft</span></div>
          <div class="status-legend-row"><span class="status-legend-icon">🟡</span><span class="status-legend-label">In Review</span></div>
          <div class="status-legend-row"><span class="status-legend-icon">🟢</span><span class="status-legend-label">Final</span></div>
          <div class="status-legend-row"><span class="status-legend-icon">📦</span><span class="status-legend-label">Archiviert</span></div>
          <div class="status-legend-row"><span class="status-legend-icon">🎬</span><span class="status-legend-label">Mit Video verlinkt</span></div>
        </div>
        <div class="scripts-list-footer">
          <span id="scriptCount">${getAllScripts().length} Skripte</span>
        </div>
      </div>
      <div class="scripts-editor-panel" id="scriptsEditorPanel">
        <div class="scripts-editor-placeholder">Wähle ein Skript aus dem Tree.</div>
      </div>
    </div>
  `;

  setupEditorEvents();
  setupHeaderButtons();
  buildJsTree();
  restoreTreeState();
  restoreLastSearch();

  // Render editor (either current active script or empty state)
  renderEditor();
}

// ─── JSTree Build ──────────────────────────────────────────────────────────
function buildJsTree() {
  const $tree = $('#scriptsTree');
  if (!$tree.length) return;

  if (jsTreeInstance) {
    try { jsTreeInstance.destroy(); } catch (e) {}
    jsTreeInstance = null;
  }

  // Ensure all default folders are present (even if empty in DB)
  const folderSet = new Set(DEFAULT_FOLDERS);
  getAllScripts().forEach(s => { if (s.folder) folderSet.add(s.folder); });
  const orderedFolders = [
    ...DEFAULT_FOLDERS.filter(f => folderSet.has(f)),
    ...[...folderSet].filter(f => !DEFAULT_FOLDERS.includes(f)).sort()
  ];

  const treeData = orderedFolders.map(folder => {
    const folderScripts = getAllScripts()
      .filter(s => s.folder === folder)
      .sort(getScriptSortComparator());

    return {
      id: `folder:${folder}`,
      text: `<span class="tree-folder-icon" data-folder-icon="${folder}">📁</span><span class="tree-folder-label" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span><span class="tree-folder-count">${folderScripts.length}</span>`,
      type: 'folder',
      li_attr: { 'data-folder': folder, 'title': `${folder} (${folderScripts.length} Skript${folderScripts.length === 1 ? '' : 'e'})` },
      state: {
        opened: true,
        disabled: false
      },
      children: folderScripts.map(s => ({
        id: `script:${s.id}`,
        text: buildScriptNodeText(s),
        type: 'script',
        li_attr: { 'data-script-id': s.id, 'data-folder': folder, 'title': s.title || 'Unbenannt' },
        state: { selected: getActiveScript()?.id === s.id }
      }))
    };
  });

  $tree.jstree({
    core: {
      data: treeData,
      check_callback: true,  // allow drag/drop, create, rename
      themes: {
        name: 'default',
        dots: true,
        icons: false,
        stripes: false,
        variant: 'small',
        responsive: true
      },
      multiple: false
    },
    plugins: ['dnd', 'contextmenu', 'search', 'types'],
    types: {
      folder: { icon: false },  // we use our own HTML icons
      script: { icon: false }
    },
    dnd: {
      always_copy: false,
      inside_pos: 'last',
      is_draggable: function(nodes) {
        // Folders are not draggable in flat mode
        return nodes.every(n => n.type === 'script');
      }
    },
    contextmenu: {
      items: function(node) {
        return buildContextMenu(node);
      }
    },
    search: {
      case_sensitive: false,
      show_only_matches: true,
      show_only_matches_children: true
    }
  });

  jsTreeInstance = $tree.jstree(true);

  // Event: open node = folder selected (optional visual feedback)
  $tree.off('select_node.jstree move_node.jstree rename_node.jstree create_node.jstree');
  $tree.on('select_node.jstree', function(e, data) {
    // Single-click on a folder → toggle open/closed (not select).
    if (data.node.type === 'folder') {
      const isOpen = data.node.state.opened;
      if (isOpen) {
        jsTreeInstance.close_node(data.node);
      } else {
        // JSTree quirk: open_node() does nothing for nodes whose children
        // were stripped during close. Re-inject from cached data, then open.
        const folderName = data.node.li_attr['data-folder'];
        const folderScripts = getAllScripts()
          .filter(s => s.folder === folderName)
          .sort(getScriptSortComparator());
        if (folderScripts.length > 0) {
          const childNodes = folderScripts.map(s => ({
            id: `script:${s.id}`,
            text: buildScriptNodeText(s),
            type: 'script',
            li_attr: { 'data-script-id': s.id, 'data-folder': folderName },
            state: { selected: getActiveScript()?.id === s.id }
          }));
          data.node.children = childNodes;
          data.node.children_d = childNodes;
        }
        jsTreeInstance.open_node(data.node);
        // Force state.opened = true (in case open_node was a no-op)
        data.node.state.opened = true;
      }
      // Persist (delayed to let JSTree finish internal state updates)
      setTimeout(() => {
        persistTreeState();
        updateFolderIcon(data.node);
        jsTreeInstance.deselect_all(true);
      }, 50);
      return;
    }
    // Single-click on a script → open editor
    if (data.node.type === 'script') {
      const sid = data.node.li_attr['data-script-id'];
      if (sid) selectScript(sid);
    }
  });

  // Update folder icons when open/close changes
  $tree.on('after_open.jstree after_close.jstree', function(e, data) {
    updateFolderIcon(data.node);
    persistTreeState();
  });

  // Event: drop (move script between folders OR reorder within folder)
  $tree.on('move_node.jstree', function(e, data) {
    handleNodeMove(data);
  });

  // Event: rename (folder or script)
  $tree.on('rename_node.jstree', function(e, data) {
    if (data.node.type === 'folder') {
      // Folder rename — handled by edit context menu (inline DBL-click)
    } else if (data.node.type === 'script') {
      handleScriptRename(data);
    }
  });

  // Event: create (new folder via context menu or button)
  $tree.on('create_node.jstree', function(e, data) {
    // Already handled by caller — data.node already has the right text.
    // We just need to create a placeholder script/folder entry if needed.
    if (data.node && data.node.type === 'folder') {
      // New empty folder created. No DB action needed — folder exists in tree.
    }
  });
}

function buildScriptNodeText(s) {
  const statusIcon = {
    'draft': '⚪',
    'in-review': '🟡',
    'final': '🟢',
    'archived': '📦'
  }[s.status] || '⚪';

  const linkBadge = s.video_id ? '<span class="tree-link-badge" title="Mit Video verlinkt">🎬</span>' : '';
  const isArchived = s.status === 'archived' ? ' tree-script-archived' : '';
  return `<span class="tree-script-label${isArchived}">${statusIcon} ${escapeHtml(s.title || 'Unbenannt')}</span>${linkBadge}`;
}

function updateFolderIcon(node) {
  if (!node || node.type !== 'folder') return;
  const folderName = node.li_attr['data-folder'];
  const isOpen = jsTreeInstance && jsTreeInstance.is_open(node);
  const icon = isOpen ? '📂' : '📁';
  // Update DOM directly (JSTree stores text as HTML, but we can rewrite it)
  const $li = jsTreeInstance.element.find(`li[data-folder="${folderName}"]`);
  $li.find('.tree-folder-icon').text(icon);
  // Persist via node state so it survives re-render
  node.li_attr = node.li_attr || {};
  node.li_attr['data-folder-icon-state'] = isOpen ? 'open' : 'closed';
}

// ─── Context Menu ──────────────────────────────────────────────────────────
function buildContextMenu(node) {
  if (node.type === 'folder') {
    const folder = node.li_attr['data-folder'];
    const isArchiv = folder === ARCHIV_FOLDER;
    return {
      'newScript': {
        label: '📄 Neues Skript hier',
        action: function() { createNewScriptInFolder(folder); }
      },
      'newFolder': {
        label: '📁 Neuen Unterfolder…',
        _disabled: true,  // flat mode: no subfolders
        action: function() {}
      },
      'rename': {
        label: '✏️ Umbenennen',
        _disabled: isArchiv,  // system folders
        action: function() { jsTreeInstance.edit(node); }
      },
      'delete': {
        label: '🗑️ Folder löschen',
        _disabled: DEFAULT_FOLDERS.includes(folder) && folder !== ARCHIV_FOLDER,  // protect default folders except Archiv
        separator_after: true,
        action: function() { deleteFolder(folder); }
      }
    };
  } else if (node.type === 'script') {
    const sid = node.li_attr['data-script-id'];
    const script = getAllScripts().find(s => s.id === sid);
    return {
      'open': {
        label: '📝 Öffnen',
        action: function() { selectScript(sid); }
      },
      'duplicate': {
        label: '📋 Duplizieren',
        action: function() { duplicateScript(sid); }
      },
      'archive': {
        label: script?.status === 'archived' ? '📦 Wiederherstellen' : '📦 Archivieren',
        action: function() { toggleArchiveScript(sid); }
      },
      'delete': {
        label: '🗑️ Löschen',
        separator_before: true,
        action: function() { deleteScriptById(sid); }
      }
    };
  }
  return {};
}

// ─── Drag&Drop Handlers ────────────────────────────────────────────────────
async function handleNodeMove(data) {
  const scriptId = data.node.li_attr['data-script-id'];
  if (!scriptId) return;
  const newParentId = data.parent;  // e.g. "folder:scripts"
  const newFolder = newParentId?.startsWith('folder:') ? newParentId.slice(7) : null;
  const newPosition = data.position;  // 0-based index in new parent

  if (!newFolder) return;  // dropped on root, ignore

  try {
    // Persist folder + position
    const res = await fetch(`${API}/scripts/${scriptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: newFolder, position: newPosition })
    });
    if (!res.ok) throw new Error('Move fehlgeschlagen');

    // Update local cache
    const script = getAllScripts().find(s => s.id === scriptId);
    if (script) {
      script.folder = newFolder;
      script.position = newPosition;
    }

    // If dragged into Archiv folder, ensure status is archived
    if (newFolder === ARCHIV_FOLDER && script && script.status !== 'archived') {
      await fetch(`${API}/scripts/${scriptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' })
      });
      script.status = 'archived';
    }

    // If dragged OUT of Archiv, restore to draft
    if (newFolder !== ARCHIV_FOLDER && script && script.status === 'archived') {
      await fetch(`${API}/scripts/${scriptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' })
      });
      script.status = 'draft';
    }

    // Refresh tree to update status icons + counts
    refreshTree();
    updateScriptCount();
    showToast(`→ ${newFolder}`);
  } catch (e) {
    console.error('Move error:', e);
    showToast('❌ Move fehlgeschlagen', true);
    refreshTree();  // revert
  }
}

async function handleScriptRename(data) {
  const scriptId = data.node.li_attr['data-script-id'];
  const newText = data.text;
  if (!scriptId || !newText) return;
  try {
    await store.actions.updateScript(scriptId, { title: newText });
    // Store subscribers handle the re-render. Re-render editor explicitly
    // if the renamed script is the active one so the title input updates.
    if (getActiveScript()?.id === scriptId) {
      renderEditor();
    }
  } catch (e) {
    console.error('Rename error:', e);
    showToast('❌ Rename fehlgeschlagen', true);
    refreshTree();
  }
}

// ─── Folder Operations ─────────────────────────────────────────────────────
async function deleteFolder(folder) {
  if (DEFAULT_FOLDERS.includes(folder) && folder !== ARCHIV_FOLDER) {
    showToast('❌ Default-Folder kann nicht gelöscht werden', true);
    return;
  }
  const count = getAllScripts().filter(s => s.folder === folder).length;
  if (count > 0) {
    const ok = confirm(`Folder „${folder}" enthält ${count} Skript(e).\n\nWohin damit?\n\nOK = Verschieben nach „scripts" & Folder löschen`);
    if (!ok) return;
    // Move all to 'scripts'
    for (const s of getAllScripts().filter(s => s.folder === folder)) {
      await fetch(`${API}/scripts/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'scripts' })
      });
    }
  } else {
    if (!confirm(`Folder „${folder}" wirklich löschen?`)) return;
  }

  // Remove folder from tree
  const node = jsTreeInstance.get_node(`folder:${folder}`);
  if (node) jsTreeInstance.delete_node(node);
  showToast(`📁 „${folder}" gelöscht`);
  await loadScripts();  // reload to sync
}

async function createNewFolderInline() {
  const name = prompt('Name des neuen Folders:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();

  if (DEFAULT_FOLDERS.includes(trimmed) || getAllScripts().some(s => s.folder === trimmed)) {
    showToast(`❌ Folder „${trimmed}" existiert bereits`, true);
    return;
  }

  // Add to tree as new root folder (empty)
  jsTreeInstance.create_node('#', {
    id: `folder:${trimmed}`,
    text: `<span class="tree-folder-label">${escapeHtml(trimmed)}</span><span class="tree-folder-count">0</span>`,
    type: 'folder',
    li_attr: { 'data-folder': trimmed },
    state: { opened: true }
  });
  showToast(`📁 Folder „${trimmed}" angelegt`);
}

// ─── Script Operations ─────────────────────────────────────────────────────
function getCurrentFolderFromTree() {
  // If a script is selected, use its folder; otherwise the first opened folder
  if (getActiveScript()?.folder) return getActiveScript().folder;
  // Try to find first selected folder in tree
  const selected = jsTreeInstance?.get_selected(true);
  if (selected?.length > 0) {
    const node = selected[0];
    if (node.type === 'folder') return node.li_attr['data-folder'];
    if (node.type === 'script') {
      const parent = jsTreeInstance.get_node(node.parent);
      if (parent) return parent.li_attr['data-folder'];
    }
  }
  return 'scripts';  // safe fallback
}

async function createNewScriptInFolder(folder) {
  if (folder === ARCHIV_FOLDER) {
    showToast('❌ Im Archiv-Folder kann kein neues Skript angelegt werden', true);
    return;
  }
  try {
    const newScript = await store.actions.createScript({
      title: 'Neues Skript',
      slug: 'script-' + Date.now(),
      folder: folder,
      status: 'draft',
      content: '',
      video_id: null,
      video_format: 'longform',
      tags: [],
      position: 0
    });
    store.actions.setActiveScript(newScript.id);
    // Store subscribers re-render the tree and count automatically.
    // Editor re-render is still needed because activeScript is a derived read.
    renderEditor();
    showToast(`📄 Neues Skript in „${folder}"`);
  } catch (err) {
    console.error(err);
    showToast('❌ ' + err.message, true);
  }
}

async function duplicateScript(scriptId) {
  const original = getAllScripts().find(s => s.id === scriptId);
  if (!original) return;
  try {
    const res = await fetch(`${API}/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: original.title + ' (Kopie)',
        slug: (original.slug || 'script') + '-kopie-' + Date.now(),
        folder: original.folder,
        status: 'draft',
        content: original.content,
        video_id: original.video_id,
        video_format: original.video_format,
        tags: original.tags || [],
        position: 0
      })
    });
    if (!res.ok) throw new Error('Fehler');
    await loadScripts();
    showToast('📋 Skript dupliziert');
  } catch (e) {
    console.error(e);
    showToast('❌ ' + e.message, true);
  }
}

async function toggleArchiveScript(scriptId) {
  const script = getAllScripts().find(s => s.id === scriptId);
  if (!script) return;

  if (script.status === 'archived') {
    // Restore: move out of Archiv + set status to draft
    if (!confirm(`📦 „${script.title}" wiederherstellen?\n\nEs wird nach „scripts" verschoben.`)) return;
    try {
      await fetch(`${API}/scripts/${scriptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft', folder: 'scripts' })
      });
      script.status = 'draft';
      script.folder = 'scripts';
      showToast('📦 Wiederhergestellt');
    } catch (e) {
      console.error(e);
      showToast('❌ ' + e.message, true);
      return;
    }
  } else {
    if (!confirm(`📦 „${script.title}" archivieren?\n\nEs wird in den Archiv-Folder verschoben.`)) return;
    try {
      await fetch(`${API}/scripts/${scriptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived', folder: 'Archiv' })
      });
      script.status = 'archived';
      script.folder = 'Archiv';
      showToast('📦 Archiviert');
    } catch (e) {
      console.error(e);
      showToast('❌ ' + e.message, true);
      return;
    }
  }
  await loadScripts();
}

async function deleteScriptById(scriptId) {
  const script = getAllScripts().find(s => s.id === scriptId);
  if (!script) return;
  if (!confirm(`🗑️ Skript „${script.title}" wirklich löschen?\n\nDas ist nicht widerrufbar!`)) return;
  try {
    await store.actions.deleteScript(scriptId);
    if (getActiveScript()?.id === scriptId) {
      store.actions.setActiveScript(null);
      renderEditor();
    }
    // Store subscribers re-render the tree and count automatically.
    showToast('🗑️ Gelöscht');
  } catch (e) {
    console.error(e);
    showToast('❌ ' + e.message, true);
  }
}

// ─── Tree State Persistence ────────────────────────────────────────────────
function persistTreeState() {
  if (!jsTreeInstance) return;
  const state = {};
  jsTreeInstance.get_json('#', { flat: true }).forEach(n => {
    if (n.type === 'folder') {
      state[n.li_attr['data-folder']] = n.state.opened;
    }
  });
  try { localStorage.setItem(TREE_STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function restoreTreeState() {
  if (!jsTreeInstance) return;
  let state = {};
  try { state = JSON.parse(localStorage.getItem(TREE_STATE_KEY) || '{}'); } catch (e) {}

  const hasState = Object.keys(state).length > 0;

  if (!hasState) {
    // First-time init (or cleared localStorage): close Archiv only
    const archivNode = jsTreeInstance.get_node(`folder:${ARCHIV_FOLDER}`);
    if (archivNode && archivNode.state.opened) {
      jsTreeInstance.close_node(archivNode);
    }
    return;
  }

  // Apply stored state: open/close per folder
  Object.keys(state).forEach(folder => {
    const node = jsTreeInstance.get_node(`folder:${folder}`);
    if (node) {
      if (state[folder] && !node.state.opened) {
        jsTreeInstance.open_node(node);
      } else if (!state[folder] && node.state.opened) {
        jsTreeInstance.close_node(node);
      }
    }
  });
}

// ─── Search ────────────────────────────────────────────────────────────────
function setupHeaderButtons() {
  const $input = $('#scriptSearchInput');
  if (!$input.length) return;

  // Debounced search
  let searchTimer;
  $input.on('input', function() {
    clearTimeout(searchTimer);
    const v = $(this).val();
    searchTimer = setTimeout(() => {
      if (jsTreeInstance) jsTreeInstance.search(v);
      try { localStorage.setItem(TREE_SEARCH_KEY, v); } catch (e) {}
    }, 200);
  });

  $('#btnNewScript').on('click', function() {
    createNewScriptInFolder(getCurrentFolderFromTree());
  });

  $('#btnNewFolder').on('click', function() {
    createNewFolderInline();
  });
}

function restoreLastSearch() {
  let v = '';
  try { v = localStorage.getItem(TREE_SEARCH_KEY) || ''; } catch (e) {}
  if (v) {
    $('#scriptSearchInput').val(v);
    if (jsTreeInstance) jsTreeInstance.search(v);
  }
}

// ─── Tree Refresh ──────────────────────────────────────────────────────────
function refreshTree() {
  if (!jsTreeInstance) return;
  buildJsTree();
  // Re-apply current search filter
  const searchVal = $('#scriptSearchInput')?.val();
  if (searchVal) jsTreeInstance.search(searchVal);
}

function updateScriptCount() {
  const el = document.getElementById('scriptCount');
  if (el) el.textContent = `${getAllScripts().length} Skript${getAllScripts().length === 1 ? '' : 'e'}`;
}

// ─── Editor Render (unchanged from before) ─────────────────────────────────
function renderEmptyState() {
  return `
    <div class="scripts-empty-state">
      <h3>Kein Skript ausgewählt</h3>
      <p>Wähle ein Skript aus dem Tree oder erstelle ein neues, um mit dem Schreiben zu beginnen.</p>
      <button onclick="createNewScriptInFolder(getCurrentFolderFromTree())">+ Neues Skript erstellen</button>
    </div>
  `;
}

function renderEditor() {
  const panel = document.getElementById('scriptsEditorPanel');
  if (!panel) return;
  if (!getActiveScript()) {
    panel.innerHTML = renderEmptyState();
    return;
  }
  panel.innerHTML = renderEditorHTML();
  setupEditorEvents();
}

function renderEditorHTML() {
  const s = getActiveScript();
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
        ${renderApproveButton()}
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
  if (!getActiveScript()) return;
  const title = getActiveScript().title || 'Unbenanntes Skript';
  const body = renderPreview(getActiveScript().content || '');
  const linkedVideo = getActiveScript().video_id ? getVideoTitle(getActiveScript().video_id) : null;
  const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const wordCount = countWords(getActiveScript().content || '');

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

// ─── Markdown Helpers ──────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderPreview(md) {
  if (!md) return '<p style="color:#a0999f;font-style:italic;">Live-Vorschau erscheint hier…</p>';

  // Cap input size to prevent catastrophic backtracking / stack overflow
  // (e.g. very long scripts with many code blocks)
  const MAX = 50000;
  const input = md.length > MAX ? md.slice(0, MAX) + '\n\n[… Inhalt gekürzt für Vorschau …]' : md;

  // Use a non-backtracking approach: split on code fences first
  const parts = input.split(/```/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Inside code fence
      out.push('<pre><code>' + escapeHtml(parts[i]) + '</code></pre>');
    } else {
      // Outside code fence — apply other transforms
      let h = parts[i]
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

      // Process line by line for lists (avoid giant single-line regex)
      const lines = h.split('\n');
      const processed = [];
      let inList = false;
      for (const line of lines) {
        if (/^- .+/.test(line)) {
          if (!inList) { processed.push('<ul>'); inList = true; }
          processed.push(line.replace(/^- (.+)$/, '<li>$1</li>'));
        } else {
          if (inList) { processed.push('</ul>'); inList = false; }
          processed.push(line);
        }
      }
      if (inList) processed.push('</ul>');

      h = processed.join('\n')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

      out.push(h);
    }
  }

  return `<p>${out.join('')}</p>`;
}

function countWords(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Editor Events ─────────────────────────────────────────────────────────
function setupEditorEvents() {
  const textarea = document.getElementById('scriptTextarea');
  if (!textarea) return;

  const select = document.getElementById('videoLinkSelect');
  if (select) {
    if (window._allVideos && window._allVideos.length > 0) {
      select.innerHTML = '<option value="">— Kein Video —</option>' +
        window._allVideos.map(v => `<option value="${v.id}">${escapeHtml(v.title)}</option>`).join('');
    }
    if (getActiveScript()?.video_id) {
      select.value = getActiveScript().video_id;
    }
  }

  // Persist tree state on any tree change
  if (jsTreeInstance) {
    jsTreeInstance.element.off('after_open.jstree persist', persistTreeState);
    jsTreeInstance.element.on('after_open.jstree after_close.jstree', persistTreeState);
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
  }, 30000);
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

// ─── CRUD Wrappers (legacy, called by editor buttons) ──────────────────────
async function selectScript(id) {
  if (isDirty && getActiveScript()) {
    await saveScript(true);
  }
  store.actions.setActiveScript(id);
  // JSTree visually syncs via state.selected in the tree data.
  // We do NOT call jsTreeInstance.select_node() here — it would re-fire
  // the select_node event and create an infinite loop.
  renderEditor();
}

async function createNewScript() {
  // Backward-compat: called by empty-state button
  return createNewScriptInFolder(getCurrentFolderFromTree());
}

async function archiveScript() {
  if (!getActiveScript()) return;
  return toggleArchiveScript(getActiveScript().id);
}

async function deleteScript() {
  if (!getActiveScript()) return;
  return deleteScriptById(getActiveScript().id);
}

function showToast(message, isError = false) {
  // Remove existing
  document.querySelectorAll('.scripts-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'scripts-toast' + (isError ? ' scripts-toast--error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('scripts-toast--show'), 10);
  setTimeout(() => {
    toast.classList.remove('scripts-toast--show');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

async function saveScript(silent = false) {
  if (!getActiveScript()) return;
  const activeBefore = getActiveScript();
  const textarea = document.getElementById('scriptTextarea');
  const titleInput = document.getElementById('scriptTitleInput');
  const content = textarea ? textarea.value : '';
  const title = titleInput ? titleInput.value : activeBefore.title;

  // Capture pre-save state so we can decide what to update in the tree
  const oldFolder = activeBefore.folder;
  const oldStatus = activeBefore.status;
  const oldTitle = activeBefore.title;

  try {
    await store.actions.updateScript(activeBefore.id, { title, content });
    isDirty = false;
    if (!silent) {
      const status = document.getElementById('saveStatus');
      if (status) { status.textContent = '✓ gespeichert'; status.style.color = '#5a9e7c'; setTimeout(() => { status.textContent = '✓ gespeichert'; status.style.color = ''; }, 2000); }
    } else {
      const status = document.getElementById('saveStatus');
      if (status) status.textContent = '✓ auto-gespeichert';
    }
    // Read fresh active record (the one the server confirmed).
    const activeAfter = getActiveScript();
    // In-place tree update (no full rebuild = no cursor jump).
    if (oldFolder !== activeAfter.folder || oldStatus !== activeAfter.status) {
      refreshTree();
    } else {
      updateScriptNodeLabel(activeAfter);
    }
  } catch (err) {
    console.error(err);
    if (!silent) alert('Fehler beim Speichern: ' + err.message);
  }
}

// Update a single script node's label without rebuilding the tree.
// Prevents cursor jump in the editor during auto-save.
function updateScriptNodeLabel(script) {
  if (!jsTreeInstance || !script) return;
  const nodeId = `script:${script.id}`;
  const node = jsTreeInstance.get_node(nodeId);
  if (!node) return;
  // Update JSTree's internal text + DOM in one go. redraw_node('full') would
  // destroy and recreate the <a>, which is the cursor-jump culprit.
  const newText = buildScriptNodeText(script);
  node.text = newText;
  // Find the rendered <a class="jstree-anchor"> and update its innerHTML
  // without touching any sibling elements (which is where the cursor lives).
  const $anchor = jsTreeInstance.element.find(`li[data-script-id="${script.id}"] > .jstree-anchor`);
  if ($anchor.length) {
    $anchor[0].innerHTML = newText;
  }
}

async function linkScriptToVideo(videoId) {
  if (!getActiveScript()) return;
  try {
    await store.actions.updateScript(getActiveScript().id, { video_id: videoId || null });
    refreshTree();
  } catch (err) {
    console.error(err);
  }
}

function getVideoTitle(videoId) {
  return videoId ? `Video #${videoId.substring(0, 8)}…` : '';
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

// ─── Approve & Move to Script (research → script) ──────────────────────────
function getLinkedVideoStatus() {
  if (!getActiveScript() || !getActiveScript().video_id) return null;
  if (!window._allVideos) return null;
  const v = window._allVideos.find(x => x.id === getActiveScript().video_id);
  return v ? v.status : null;
}

function renderApproveButton() {
  const linkedStatus = getLinkedVideoStatus();
  if (!getActiveScript() || !getActiveScript().video_id || linkedStatus !== 'research') {
    return '';
  }
  const videoTitle = getVideoTitle(getActiveScript().video_id) || 'verlinktes Video';
  return `<button class="btn btn--approve" onclick="approveAndMoveToScript()" title="Video ${escapeHtml(videoTitle)} von 'research' auf 'script' moven — signalisiert: Skript ist freigegeben für die Aufnahme-Phase">🟢 Approve & move to script</button>`;
}

async function approveAndMoveToScript() {
  if (!getActiveScript() || !getActiveScript().video_id) return;
  const linkedStatus = getLinkedVideoStatus();
  if (linkedStatus !== 'research') {
    showToast?.(`Video ist bereits im Status '${linkedStatus}', kein Move nötig.`) ||
      alert(`Video ist bereits im Status '${linkedStatus}', kein Move nötig.`);
    return;
  }
  if (!confirm(`Video "${getVideoTitle(getActiveScript().video_id)}" auf Status 'script' moven?\n\nDas signalisiert: Skript ist freigegeben für die Aufnahme-Phase.`)) return;

  try {
    const res = await fetch(`${API}/videos/${getActiveScript().video_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'script' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Update local state
    const v = window._allVideos.find(x => x.id === getActiveScript().video_id);
    if (v) v.status = 'script';
    showToast?.('✅ Video-Status auf "script" gesetzt.') ||
      alert('✅ Video-Status auf "script" gesetzt.');
    renderEditor(); // re-render to hide the button (no longer research)
    refreshTree();
  } catch (err) {
    console.error('approveAndMoveToScript failed:', err);
    showToast?.(`❌ Fehler beim Move: ${err.message}`) ||
      alert(`❌ Fehler beim Move: ${err.message}`);
  }
}
