// Phase 1 tests for the Contentix state store.
// Runs with `node --test tests/store.test.js`.
//
// We can't `require('../frontend/store.js')` directly because it has
// browser-only branches (window.ContentixStore) and references to
// fetch/crypto globals. So we isolate the pure parts via a vm sandbox,
// same pattern as sort-comparator.test.js.
//
// What's covered:
//   - createStore shape and seed-isolation
//   - select / subscribe / unsubscribe
//   - setState with no-op detection (no notify if nothing changed)
//   - action.setActiveScript / setActiveView (synchronous writes)
//   - subscribe-listener exception isolation
//
// What's NOT covered here (browser-only, hits the live API):
//   - loadScripts / createScript / updateScript / deleteScript (async,
//     need fetch mocks — coming in Phase 2 alongside the scripts.js
//     migration)

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

// --- Load the store module in a sandbox ---------------------------------
// store.js calls uuidv4() (defined in utils.js) for createScript/createVideo,
// so we load utils.js first to expose uuidv4 in the sandbox.

const utilsPath = path.join(__dirname, '..', 'frontend', 'utils.js');
const utilsSrc = fs.readFileSync(utilsPath, 'utf8');
const storePath = path.join(__dirname, '..', 'frontend', 'store.js');
const storeSrc = fs.readFileSync(storePath, 'utf8');

const sandbox = { console, structuredClone, JSON, crypto, fetch, Promise, setTimeout };
vm.createContext(sandbox);
vm.runInContext(utilsSrc, sandbox);
vm.runInContext(storeSrc, sandbox);

// Tests need to mock the fetch that the store *inside the sandbox* uses.
// We expose a helper that swaps sandbox.fetch and restores it after.
const originalSandboxFetch = sandbox.fetch;
function withMockFetch(mockFn, fn) {
  sandbox.fetch = mockFn;
  return Promise.resolve()
    .then(fn)
    .finally(() => { sandbox.fetch = originalSandboxFetch; });
}

const createStore = sandbox.createStore;
const DEFAULT_STATE = {
  scripts: [],
  videos: [],
  history: [],
  ui: { activeScriptId: null, activeView: 'bibliothek' },
  meta: { loading: { scripts: false, videos: false }, errors: {} }
};

// --- Helpers -------------------------------------------------------------

function freshStore(extra = {}) {
  return createStore({ ...structuredClone(DEFAULT_STATE), ...extra });
}

// --- Tests ---------------------------------------------------------------

test('createStore returns a store with the expected shape', () => {
  const store = freshStore();
  assert.equal(typeof store.select, 'function');
  assert.equal(typeof store.subscribe, 'function');
  assert.equal(typeof store.setState, 'function');
  assert.equal(typeof store.actions, 'object');
  assert.equal(typeof store.actions.loadScripts, 'function');
  assert.equal(typeof store.actions.createScript, 'function');
  assert.equal(typeof store.actions.updateScript, 'function');
  assert.equal(typeof store.actions.deleteScript, 'function');
  assert.equal(typeof store.actions.setActiveScript, 'function');
  assert.equal(typeof store.actions.setActiveView, 'function');
  // Phase 3 additions:
  assert.equal(typeof store.actions.loadVideos, 'function');
  assert.equal(typeof store.actions.updateVideo, 'function');
  assert.equal(typeof store.actions.deleteVideo, 'function');
  assert.equal(typeof store.actions.createVideo, 'function');
});

test('createStore deep-clones the seed so callers cannot mutate by reference', () => {
  const seed = structuredClone(DEFAULT_STATE);
  seed.scripts.push({ id: 'x', title: 'X' });
  const store = createStore(seed);
  // Mutating the original seed afterwards must not leak into the store.
  seed.scripts.push({ id: 'y', title: 'Y' });
  assert.equal(store.select(s => s.scripts.length), 1);
});

test('select reads a synchronous snapshot via selector', () => {
  const store = freshStore();
  assert.deepEqual(store.select(s => s.scripts), []);
  assert.equal(store.select(s => s.ui.activeView), 'bibliothek');
});

test('subscribe fires on every state change and returns an unsubscribe', () => {
  const store = freshStore();
  let calls = 0;
  let lastState = null;
  const unsub = store.subscribe(s => { calls++; lastState = s; });
  store.actions.setActiveScript('abc');
  assert.equal(calls, 1);
  assert.equal(lastState.ui.activeScriptId, 'abc');
  store.actions.setActiveScript('def');
  assert.equal(calls, 2);
  unsub();
  store.actions.setActiveScript('ghi');
  assert.equal(calls, 2, 'listener should not fire after unsubscribe');
});

test('multiple subscribers all receive notifications', () => {
  const store = freshStore();
  let a = 0, b = 0;
  store.subscribe(() => a++);
  store.subscribe(() => b++);
  store.actions.setActiveView('scripts');
  store.actions.setActiveView('kanban');
  assert.equal(a, 2);
  assert.equal(b, 2);
});

test('setState with no-op mutation does NOT notify subscribers', () => {
  const store = freshStore();
  let calls = 0;
  store.subscribe(() => calls++);
  // No-op: produce a draft identical to current state.
  const result = store.setState(draft => {
    // touch but don't change
    void draft;
  });
  assert.equal(result, false);
  assert.equal(calls, 0);
});

test('setState with a real change notifies and returns true', () => {
  const store = freshStore();
  let calls = 0;
  store.subscribe(() => calls++);
  const result = store.setState(draft => { draft.ui.activeScriptId = 'x'; });
  assert.equal(result, true);
  assert.equal(calls, 1);
  assert.equal(store.select(s => s.ui.activeScriptId), 'x');
});

test('actions.setActiveScript updates ui.activeScriptId', () => {
  const store = freshStore();
  store.actions.setActiveScript('script-1');
  assert.equal(store.select(s => s.ui.activeScriptId), 'script-1');
  store.actions.setActiveScript(null);
  assert.equal(store.select(s => s.ui.activeScriptId), null);
});

test('actions.setActiveView updates ui.activeView', () => {
  const store = freshStore();
  store.actions.setActiveView('scripts');
  assert.equal(store.select(s => s.ui.activeView), 'scripts');
});

test('a subscriber that throws does not break other subscribers', () => {
  const store = freshStore();
  let goodCalls = 0;
  store.subscribe(() => { throw new Error('boom'); });
  store.subscribe(() => { goodCalls++; });
  // Suppress console.error noise from the expected throw.
  const origErr = console.error;
  console.error = () => {};
  try {
    store.actions.setActiveView('kanban');
  } finally {
    console.error = origErr;
  }
  assert.equal(goodCalls, 1, 'second listener must still run after first threw');
});

test('nested state mutations work via setState producer', () => {
  const store = freshStore();
  store.setState(draft => {
    draft.scripts.push({ id: 'a', title: 'A' });
    draft.scripts.push({ id: 'b', title: 'B' });
  });
  const scripts = store.select(s => s.scripts);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].id, 'a');
  assert.equal(scripts[1].id, 'b');
});

test('mutating a snapshot returned by select does not affect the store', () => {
  const store = freshStore();
  store.setState(d => { d.scripts.push({ id: 'x', title: 'X' }); });
  const snap = store.select(s => s.scripts);
  // The snapshot is a deep clone (structuredClone round-trip via JSON),
  // so pushing to it must not mutate store state.
  snap.push({ id: 'y', title: 'Y' });
  assert.equal(store.select(s => s.scripts.length), 1);
});

test('subscriber that unsubscribes itself during notification does not blow up', () => {
  const store = freshStore();
  let unsub;
  const calls = [];
  unsub = store.subscribe(s => {
    calls.push(s.ui.activeScriptId);
    if (calls.length === 1) unsub();
  });
  store.subscribe(() => calls.push('other'));
  store.actions.setActiveScript('a');
  store.actions.setActiveScript('b');
  // First listener got 'a' then unsubscribed itself. Second listener
  // got both. First listener should NOT have been called for 'b'.
  assert.deepEqual(calls, ['a', 'other', 'other']);
});

test('subscriber count diagnostic reflects subscribe/unsubscribe', () => {
  const store = freshStore();
  assert.equal(store._meta.subscriberCount(), 0);
  const u1 = store.subscribe(() => {});
  const u2 = store.subscribe(() => {});
  assert.equal(store._meta.subscriberCount(), 2);
  u1();
  assert.equal(store._meta.subscriberCount(), 1);
  u2();
  assert.equal(store._meta.subscriberCount(), 0);
});

// --- Async action: createScript with rollback on failure ---------------

test('createScript: optimistic insert happens before network call', async () => {
  const store = freshStore();
  await withMockFetch(() => new Promise(() => {}), async () => {
    const promise = store.actions.createScript({ title: 'Optimistic' });
    const scripts = store.select(s => s.scripts);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].title, 'Optimistic');
    assert.equal(scripts[0].__optimistic, true);
    promise.catch(() => {});  // suppress unhandled rejection on hang
  });
});

test('createScript: server error rolls back the optimistic insert', async () => {
  const store = freshStore();
  await withMockFetch(
    async () => ({ ok: false, status: 500, statusText: 'Server Error' }),
    async () => {
      await assert.rejects(
        () => store.actions.createScript({ title: 'Will fail' }),
        /HTTP 500/
      );
      const scripts = store.select(s => s.scripts);
      assert.equal(scripts.length, 0, 'optimistic insert must be rolled back');
      assert.equal(store.select(s => s.meta.errors.scripts), 'HTTP 500');
    }
  );
});

test('createScript: success replaces optimistic insert with server record', async () => {
  const store = freshStore();
  await withMockFetch(
    async (url, opts) => {
      if (opts && opts.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'server-id-1',
            title: 'Server record',
            folder: 'drafts',
            created_at: '2026-06-25T10:00:00Z'
          })
        };
      }
      return { ok: false, status: 404 };
    },
    async () => {
      const created = await store.actions.createScript({ title: 'New' });
      assert.equal(created.id, 'server-id-1');
      const scripts = store.select(s => s.scripts);
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].id, 'server-id-1');
      assert.equal(scripts[0].__optimistic, false);
    }
  );
});

test('deleteScript: removes from state, rolls back on server error', async () => {
  const store = freshStore();
  store.setState(d => { d.scripts.push({ id: 'd1', title: 'Doomed' }); });
  await withMockFetch(async () => ({ ok: false, status: 404 }), async () => {
    await assert.rejects(() => store.actions.deleteScript('d1'));
    const scripts = store.select(s => s.scripts);
    assert.equal(scripts.length, 1, 'rollback re-inserts the deleted script');
    assert.equal(scripts[0].id, 'd1');
  });
});

test('updateScript: applies patch optimistically, rolls back on error', async () => {
  const store = freshStore();
  store.setState(d => { d.scripts.push({ id: 'u1', title: 'Old', folder: 'X' }); });
  await withMockFetch(async () => ({ ok: false, status: 500 }), async () => {
    await assert.rejects(() =>
      store.actions.updateScript('u1', { title: 'New' })
    );
    const scripts = store.select(s => s.scripts);
    assert.equal(scripts[0].title, 'Old', 'rollback restores pre-patch title');
  });
});

test('loadScripts: cancellation marks earlier in-flight call as ignored', async () => {
  const store = freshStore();
  let callCount = 0;
  await withMockFetch(async () => {
    callCount++;
    if (callCount === 1) {
      await new Promise(r => setTimeout(r, 50));
      return { ok: true, status: 200, json: async () => [{ id: 'first', title: 'First' }] };
    }
    return { ok: true, status: 200, json: async () => [{ id: 'second', title: 'Second' }] };
  }, async () => {
    const p1 = store.actions.loadScripts();
    const p2 = store.actions.loadScripts();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.length, 0, 'cancelled load returns empty array');
    assert.equal(r2.length, 1);
    assert.equal(store.select(s => s.scripts[0].id), 'second');
    assert.equal(store.select(s => s.meta.loading.scripts), false);
  });
});

// --- Phase 3: video actions ---

test('loadVideos: fetches and stores videos array', async () => {
  const store = freshStore();
  await withMockFetch(
    async () => ({ ok: true, status: 200, json: async () => [{ id: 'v1', title: 'V1' }] }),
    async () => {
      const result = await store.actions.loadVideos();
      assert.equal(result.length, 1);
      assert.equal(store.select(s => s.videos[0].id), 'v1');
      assert.equal(store.select(s => s.meta.loading.videos), false);
    }
  );
});

test('loadVideos: HTTP error sets meta.errors.videos and returns []', async () => {
  const store = freshStore();
  await withMockFetch(
    async () => ({ ok: false, status: 503 }),
    async () => {
      const result = await store.actions.loadVideos();
      assert.equal(result.length, 0);
      assert.equal(store.select(s => s.meta.errors.videos), 'HTTP 503');
    }
  );
});

test('updateVideo: applies patch optimistically, rolls back on error', async () => {
  const store = freshStore();
  store.setState(d => { d.videos.push({ id: 'v1', title: 'Old', status: 'planned' }); });
  await withMockFetch(async () => ({ ok: false, status: 500 }), async () => {
    await assert.rejects(() =>
      store.actions.updateVideo('v1', { title: 'New' })
    );
    const videos = store.select(s => s.videos);
    assert.equal(videos[0].title, 'Old', 'rollback restores pre-patch title');
  });
});

test('updateVideo: success replaces optimistic record with server response', async () => {
  const store = freshStore();
  store.setState(d => { d.videos.push({ id: 'v1', title: 'Old', status: 'planned' }); });
  await withMockFetch(
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'v1', title: 'Server-confirmed', status: 'planned' })
    }),
    async () => {
      const updated = await store.actions.updateVideo('v1', { title: 'Server-confirmed' });
      assert.equal(updated.title, 'Server-confirmed');
      assert.equal(store.select(s => s.videos[0].title), 'Server-confirmed');
    }
  );
});

test('updateVideo: throws when video not found', async () => {
  const store = freshStore();
  await assert.rejects(
    () => store.actions.updateVideo('nope', { title: 'X' }),
    /video nope not found/
  );
});

test('deleteVideo: removes from state, rolls back on server error', async () => {
  const store = freshStore();
  store.setState(d => { d.videos.push({ id: 'v1', title: 'Doomed' }); });
  await withMockFetch(async () => ({ ok: false, status: 404 }), async () => {
    await assert.rejects(() => store.actions.deleteVideo('v1'));
    const videos = store.select(s => s.videos);
    assert.equal(videos.length, 1, 'rollback re-inserts deleted video');
    assert.equal(videos[0].id, 'v1');
  });
});

test('deleteVideo: success returns the deleted record', async () => {
  const store = freshStore();
  store.setState(d => { d.videos.push({ id: 'v1', title: 'Going away' }); });
  await withMockFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ id: 'v1', title: 'Going away' }) }),
    async () => {
      const deleted = await store.actions.deleteVideo('v1');
      assert.equal(deleted.id, 'v1');
      assert.equal(store.select(s => s.videos.length), 0);
    }
  );
});

test('deleteVideo: no-op when video not in state', async () => {
  const store = freshStore();
  await withMockFetch(
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
    async () => {
      const result = await store.actions.deleteVideo('nonexistent');
      assert.equal(result, null);
    }
  );
});

test('createVideo: optimistic insert, reconciled with server record', async () => {
  const store = freshStore();
  await withMockFetch(
    async (url, opts) => {
      if (opts && opts.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'server-v1', title: 'New video', status: 'planned' })
        };
      }
      return { ok: false, status: 404 };
    },
    async () => {
      const created = await store.actions.createVideo({ title: 'New video' });
      assert.equal(created.id, 'server-v1');
      const videos = store.select(s => s.videos);
      assert.equal(videos.length, 1);
      assert.equal(videos[0].__optimistic, false);
    }
  );
});

test('createVideo: server error rolls back optimistic insert', async () => {
  const store = freshStore();
  await withMockFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      await assert.rejects(() => store.actions.createVideo({ title: 'Will fail' }));
      assert.equal(store.select(s => s.videos.length), 0);
    }
  );
});