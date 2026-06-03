/* ==========================================================================
   CONTENTIX — Shared Utility Functions
   ========================================================================== */

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
function showToast(message, durationMs = 2500) {
  let toast = document.getElementById('kanbanToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('kanban-toast--visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('kanban-toast--visible');
  }, durationMs);
}
