/* ==========================================================================
   CONTENTIX — Shared Utility Functions
   ========================================================================== */

/**
 * Returns a comparator function for sorting Contentix script objects.
 *
 * Sort order:
 *   1. `position` ascending (missing / null / undefined → 0)
 *   2. `title` ascending via `String.prototype.localeCompare` with the
 *      user-default locale. Empty / missing titles sort BEFORE non-empty
 *      ones (localeCompare default behavior).
 *
 * Used by scripts.js (buildJsTree + select_node handler) — replaces two
 * inline `.sort(...)` expressions that previously had to stay in sync by
 * hand. Spec: docs/r2-script-sort-spec.md. Tests: tests/sort-comparator.test.js.
 *
 * @returns {(a: object, b: object) => number}
 */
function getScriptSortComparator() {
  return (a, b) => {
    const posA = a.position || 0;
    const posB = b.position || 0;
    if (posA !== posB) return posA - posB;
    // Coerce undefined/null → '' so localeCompare never sees undefined
    // (which returns NaN and breaks sort).
    const titleA = (a.title == null) ? '' : a.title;
    const titleB = (b.title == null) ? '' : b.title;
    return titleA.localeCompare(titleB);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function formatNumber(n) {
  if (!n) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n;
}

// Focus the first focusable input in a modal after it opens.
// Used by openCardModal (kanban.js) and openModal (app.js) so that
// the user can start typing immediately without clicking the field.
// Skips hidden inputs and buttons. Selects text in text inputs so
// editing existing values is a one-key operation.
function focusFirstField(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  // requestAnimationFrame ensures the modal is rendered before we focus
  requestAnimationFrame(() => {
    const firstField = modal.querySelector(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
    if (firstField) {
      firstField.focus();
      // Select existing text in text inputs for quick overwrite/edit
      if (firstField.tagName === 'INPUT' && firstField.type === 'text' && firstField.value) {
        firstField.select();
      }
    }
  });
}

// Returns true if the user's keyboard focus is in a form field where
// typing should NOT trigger global shortcuts. Used to gate single-key
// shortcuts like "+" or "n" so they don't fire while writing a title.
function isTypingInField(e) {
  const t = e.target;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT') {
    // Most input types should not intercept shortcuts. Type=text/email/etc do.
    const type = (t.type || 'text').toLowerCase();
    const typingTypes = ['text', 'email', 'url', 'search', 'password', 'number', 'tel', 'date', 'time'];
    return typingTypes.includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT';
}

// Show a transient toast at the bottom of the screen. Used to give
// feedback on shortcut actions (e.g. "Card created"). Auto-dismisses.
// Pass durationMs=0 for a persistent toast (call hideToast() to dismiss).
function showToast(message, durationMs = 2500) {
  let toast = document.getElementById('kanbanToast');
  if (!toast) return null;
  toast.textContent = message;
  toast.classList.add('kanban-toast--visible');
  clearTimeout(showToast._timer);
  if (durationMs > 0) {
    showToast._timer = setTimeout(() => {
      toast.classList.remove('kanban-toast--visible');
    }, durationMs);
  }
  return toast;
}

// Manually hide the current toast. No-op if not visible.
function hideToast() {
  const toast = document.getElementById('kanbanToast');
  if (!toast) return;
  toast.classList.remove('kanban-toast--visible');
  clearTimeout(showToast._timer);
}

// Promise-basierter Confirm-Dialog. Returns true wenn "OK" geklickt.
// Verwendet das bestehende Confirm-Modal falls vorhanden, sonst einfaches window.confirm-Fallback.
function showConfirm(message, okLabel = 'OK') {
  return new Promise(resolve => {
    // Bevorzugt das app.js-Confirm-Modal falls vorhanden
    const overlay = document.getElementById('confirmOverlay');
    const textEl = document.getElementById('confirmText');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    if (overlay && textEl && okBtn && cancelBtn) {
      textEl.textContent = message;
      const okLabelEl = okBtn.querySelector('.btn__label') || okBtn;
      okLabelEl.textContent = okLabel;
      overlay.classList.add('confirm-overlay--visible');
      const cleanup = () => {
        overlay.classList.remove('confirm-overlay--visible');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onBackdrop);
      };
      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      const onBackdrop = e => { if (e.target === overlay) onCancel(); };
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onBackdrop);
    } else {
      // Fallback
      resolve(window.confirm(message));
    }
  });
}
