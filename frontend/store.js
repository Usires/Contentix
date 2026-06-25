/* ==========================================================================
   CONTENTIX — Central State Store
   ==========================================================================
   Single source of truth for shared application state.

   Per ADR-001 (docs/adr-001-state-store.md):
   - State is exposed as READ-ONLY SNAPSHOTS to consumers (select).
   - Mutations go through ACTION FUNCTIONS only.
   - Every change fires subscribers.
   - Async actions handle their own cancellation + error path.
   - Local UI state (e.g. drag-and-drop transient data) does NOT belong
     here — use plain module-globals for that.

   API quick reference:
     const store = createStore(initialState);
     store.select(state => state.scripts);     // read snapshot
     store.subscribe(state => { ... });        // listen, returns unsub()
     store.actions.loadScripts();              // async action
     store.actions.createScript({ ... });      // async action
     store.setState(producer);                 // internal sync mutation
     // (callers should prefer actions; setState exposed for tests)

   For tests, see tests/store.test.js (node --test).
   ========================================================================== */

/**
 * Creates a new store with the given initial state.
 *
 * @param {object} initialState - Plain object. Deep-cloned so callers
 *   cannot mutate the seed by reference.
 * @returns {object} store - { state, select, subscribe, setState, actions }
 */
function createStore(initialState) {
  // Deep-clone the seed so callers can't mutate it by reference.
  const state = structuredClone(initialState);

  const subscribers = new Set();
  let actionInProgress = 0;  // for future optimistic-update rollback hooks

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  /**
   * Run a selector function against a deep-cloned snapshot of the current
   * state. Consumers receive a fresh copy on every call — mutations to
   * the returned value NEVER affect the store. This is the contract that
   * makes "read-only snapshot" actually true.
   *
   * Performance note: deep-clone via JSON round-trip. Fine for our scale
   * (hundreds of scripts/videos, not millions). If this ever becomes a
   * hotspot, swap for a structural-sharing clone (immer-style) without
   * changing the API.
   *
   * @template T
   * @param {(state: object) => T} selector
   * @returns {T}
   */
  function select(selector) {
    const snapshot = JSON.parse(JSON.stringify(state));
    return selector(snapshot);
  }

  // ---------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------

  /**
   * Subscribe to state changes. Listener gets the *new* state.
   * Returns an unsubscribe function (always call it on teardown).
   *
   * @param {(state: object) => void} listener
   * @returns {() => void} unsubscribe
   */
  function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  // ---------------------------------------------------------------------
  // Writes (low-level; actions call this)
  // ---------------------------------------------------------------------

  /**
   * Apply a mutation to the state. `producer` receives a mutable DRAFT
   * (so it can do nested updates like `draft.scripts.push(x)`); the
   * store snapshots the result and notifies subscribers if anything
   * actually changed.
   *
   * Mostly used by action functions. Exposed on the store for tests.
   *
   * @param {(draft: object) => void} producer
   * @returns {boolean} true if state actually changed
   */
  function setState(producer) {
    // Structured-clone for the draft so producer can't escape into
    // the live state object via references.
    const draft = structuredClone(state);
    producer(draft);
    // Compare structurally. For arrays of objects, structuredClone
    // round-trip is the simplest robust equality.
    const before = JSON.stringify(state);
    const after = JSON.stringify(draft);
    if (before === after) return false;
    // Replace live state in place so existing references stay valid.
    // (Subscribers always re-read via select(), so this is fine.)
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, draft);
    notify();
    return true;
  }

  function notify() {
    // Iterate over a snapshot so a subscriber that unsubscribes itself
    // (or subscribes a new one) doesn't trip the iteration.
    [...subscribers].forEach(fn => {
      try { fn(state); }
      catch (err) {
        // A listener crash must not break other listeners or the store.
        console.error('[store] subscriber threw:', err);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  //
  // Actions are the ONLY way views should change shared state. They
  // combine an API call with a state mutation and an error path.
  //
  // Naming convention: verb-noun, present tense (loadScripts, createScript,
  // deleteScript, ...). Async actions return a Promise.

  /**
   * In-flight cancellation tokens, keyed by action name. Lets later calls
   * cancel earlier ones (e.g. user types in search box fast).
   */
  const inflight = new Map();

  function cancelPrevious(actionName) {
    const prev = inflight.get(actionName);
    if (prev) prev.cancelled = true;
  }

  const API = '/api';

  const actions = {
    /**
     * Fetch all scripts from the backend and put them in state.scripts.
     * Cancellation: if a previous loadScripts is in flight, mark it
     * cancelled; its response is ignored.
     *
     * @returns {Promise<Array>} the loaded scripts (or [] on cancel/error)
     */
    async loadScripts() {
      cancelPrevious('loadScripts');
      const token = { cancelled: false };
      inflight.set('loadScripts', token);
      setState(s => { s.meta.loading.scripts = true; s.meta.errors.scripts = null; });
      try {
        const res = await fetch(`${API}/scripts`);
        if (token.cancelled) return [];
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const scripts = await res.json();
        if (token.cancelled) return [];
        setState(s => { s.scripts = scripts; });
        return scripts;
      } catch (err) {
        if (token.cancelled) return [];
        console.error('[store] loadScripts failed:', err);
        setState(s => { s.meta.errors.scripts = err.message; });
        return [];
      } finally {
        if (!token.cancelled) {
          setState(s => { s.meta.loading.scripts = false; });
          inflight.delete('loadScripts');
        }
      }
    },

    /**
     * Create a new script via POST /api/scripts. Optimistic: the new
     * script is added to state.scripts immediately with a temporary
     * `__optimistic: true` flag. On success the flag is cleared and
     * the server-side record replaces the optimistic one.
     *
     * @param {{ title: string, folder?: string, content?: string, status?: string }} input
     * @returns {Promise<object>} the created script
     */
    async createScript(input) {
      const optimistic = {
        ...input,
        id: `optimistic-${uuidv4()}`,
        position: Date.now(),
        created_at: new Date().toISOString(),
        __optimistic: true
      };
      setState(s => { s.scripts.unshift(optimistic); });
      try {
        const res = await fetch(`${API}/scripts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = await res.json();
        // Replace optimistic with real.
        setState(s => {
          const idx = s.scripts.findIndex(x => x.id === optimistic.id);
          if (idx !== -1) s.scripts[idx] = { ...created, __optimistic: false };
        });
        return created;
      } catch (err) {
        console.error('[store] createScript failed:', err);
        // Roll back optimistic insert.
        setState(s => {
          const idx = s.scripts.findIndex(x => x.id === optimistic.id);
          if (idx !== -1) s.scripts.splice(idx, 1);
          s.meta.errors.scripts = err.message;
        });
        throw err;
      }
    },

    /**
     * Persist edits to an existing script.
     *
     * @param {string} id
     * @param {object} patch - partial fields to update
     * @returns {Promise<object>} the updated script
     */
    async updateScript(id, patch) {
      // Snapshot for rollback.
      const before = state.scripts.find(s => s.id === id);
      if (!before) throw new Error(`script ${id} not found`);
      setState(s => {
        const target = s.scripts.find(x => x.id === id);
        if (target) Object.assign(target, patch);
      });
      try {
        const res = await fetch(`${API}/scripts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        setState(s => {
          const idx = s.scripts.findIndex(x => x.id === id);
          if (idx !== -1) s.scripts[idx] = updated;
        });
        return updated;
      } catch (err) {
        console.error('[store] updateScript failed:', err);
        // Rollback to the pre-patch record.
        setState(s => {
          const idx = s.scripts.findIndex(x => x.id === id);
          if (idx !== -1) s.scripts[idx] = { ...before };
          s.meta.errors.scripts = err.message;
        });
        throw err;
      }
    },

    /**
     * Delete a script by id.
     *
     * @param {string} id
     * @returns {Promise<void>}
     */
    async deleteScript(id) {
      const before = state.scripts.find(s => s.id === id);
      if (!before) return;
      setState(s => {
        const idx = s.scripts.findIndex(x => x.id === id);
        if (idx !== -1) s.scripts.splice(idx, 1);
      });
      try {
        const res = await fetch(`${API}/scripts/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('[store] deleteScript failed:', err);
        // Rollback: re-insert.
        setState(s => {
          s.scripts.push(before);
          s.meta.errors.scripts = err.message;
        });
        throw err;
      }
    },

    /**
     * Set the currently active script (the one being edited). Pass null
     * to clear.
     *
     * @param {string|null} id
     */
    setActiveScript(id) {
      setState(s => { s.ui.activeScriptId = id; });
    },

    /**
     * Switch the sidebar's active view (e.g. 'bibliothek', 'scripts',
     * 'kanban', 'calendar', 'history'). Currently only used by scripts.js
     * but exposed here so kanban/calendar can subscribe and react.
     *
     * @param {string} viewName
     */
    setActiveView(viewName) {
      setState(s => { s.ui.activeView = viewName; });
    },

    // -------------------------------------------------------------------
    // Video actions (used by kanban.js, calendar.js, app.js)
    // -------------------------------------------------------------------

    /**
     * Fetch all videos (a.k.a. "cards") from the backend. Mirrors
     * loadScripts in shape and behavior.
     *
     * @returns {Promise<Array>}
     */
    async loadVideos() {
      cancelPrevious('loadVideos');
      const token = { cancelled: false };
      inflight.set('loadVideos', token);
      setState(s => { s.meta.loading.videos = true; s.meta.errors.videos = null; });
      try {
        const res = await fetch(`${API}/videos`);
        if (token.cancelled) return [];
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const videos = await res.json();
        if (token.cancelled) return [];
        setState(s => { s.videos = videos; });
        return videos;
      } catch (err) {
        if (token.cancelled) return [];
        console.error('[store] loadVideos failed:', err);
        setState(s => { s.meta.errors.videos = err.message; });
        return [];
      } finally {
        if (!token.cancelled) {
          setState(s => { s.meta.loading.videos = false; });
          inflight.delete('loadVideos');
        }
      }
    },

    /**
     * Persist edits to an existing video via PATCH /api/videos/:id.
     * Optimistic + rollback like updateScript.
     *
     * @param {string} id
     * @param {object} patch
     * @returns {Promise<object>}
     */
    async updateVideo(id, patch) {
      const before = state.videos.find(v => v.id === id);
      if (!before) throw new Error(`video ${id} not found`);
      setState(s => {
        const target = s.videos.find(x => x.id === id);
        if (target) Object.assign(target, patch);
      });
      try {
        const res = await fetch(`${API}/videos/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        setState(s => {
          const idx = s.videos.findIndex(x => x.id === id);
          if (idx !== -1) s.videos[idx] = updated;
        });
        return updated;
      } catch (err) {
        console.error('[store] updateVideo failed:', err);
        setState(s => {
          const idx = s.videos.findIndex(x => x.id === id);
          if (idx !== -1) s.videos[idx] = { ...before };
          s.meta.errors.videos = err.message;
        });
        throw err;
      }
    },

    /**
     * Delete a video by id. Returns the deleted record for rollback.
     *
     * @param {string} id
     * @returns {Promise<object>}
     */
    async deleteVideo(id) {
      const before = state.videos.find(v => v.id === id);
      if (!before) return null;
      setState(s => {
        const idx = s.videos.findIndex(x => x.id === id);
        if (idx !== -1) s.videos.splice(idx, 1);
      });
      try {
        const res = await fetch(`${API}/videos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.error('[store] deleteVideo failed:', err);
        setState(s => {
          s.videos.push(before);
          s.meta.errors.videos = err.message;
        });
        throw err;
      }
    },

    /**
     * Create a new video via POST /api/videos. Optimistic with rollback.
     *
     * @param {object} input
     * @returns {Promise<object>}
     */
    async createVideo(input) {
      const optimistic = {
        ...input,
        id: `optimistic-${uuidv4()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        __optimistic: true
      };
      setState(s => { s.videos.unshift(optimistic); });
      try {
        const res = await fetch(`${API}/videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = await res.json();
        setState(s => {
          const idx = s.videos.findIndex(x => x.id === optimistic.id);
          if (idx !== -1) s.videos[idx] = { ...created, __optimistic: false };
        });
        return created;
      } catch (err) {
        console.error('[store] createVideo failed:', err);
        setState(s => {
          const idx = s.videos.findIndex(x => x.id === optimistic.id);
          if (idx !== -1) s.videos.splice(idx, 1);
          s.meta.errors.videos = err.message;
        });
        throw err;
      }
    }
  };

  return {
    state,
    select,
    subscribe,
    setState,
    actions,
    // Diagnostics: useful for tests and devtools.
    _meta: {
      subscriberCount: () => subscribers.size,
      inflight: () => [...inflight.keys()]
    }
  };
}

// -------------------------------------------------------------------------
// Module-level singleton: the one store the app uses.
// -------------------------------------------------------------------------
//
// Views import this directly. Tests can call createStore() with their
// own initial state to get an isolated instance.

const DEFAULT_STATE = {
  scripts: [],
  videos: [],
  history: [],
  ui: {
    activeScriptId: null,
    activeView: 'bibliothek'
  },
  meta: {
    loading: { scripts: false, videos: false },
    errors: {}
  }
};

const store = createStore(DEFAULT_STATE);

// Expose to window for non-module scripts (legacy compat for inline
// <script> blocks that pre-date ESM). Module-aware consumers should
// `import` from this file via a build step or globalThis.
if (typeof window !== 'undefined') {
  window.ContentixStore = store;
}