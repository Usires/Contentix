/* ==========================================================================
   EFFECTS — Confetti & Animations
   ========================================================================== */

function confettiAtColumn(columnId) {
  if (columnId !== 'uploaded') return;

  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const colEl = board.querySelector(`[data-column="${columnId}"]`);
  if (!colEl) return;

  const rect = colEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Create canvas overlay
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const colors = ['#7c5cbf', '#c4955a', '#5a9e7c', '#4a90a4', '#c4b5d9', '#f7f3ee'];
  const particles = [];

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: cx + (Math.random() - 0.5) * 40,
      y: cy + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -14 - 4,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    });
  }

  let frame = 0;
  const maxFrames = 90;

  function draw() {
    if (frame >= maxFrames) {
      document.body.removeChild(canvas);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    for (const p of particles) {
      if (p.alpha <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.4; // gravity
      p.alpha -= 0.015;
      p.rotation += p.rotationSpeed;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    frame++;
    requestAnimationFrame(draw);
  }

  draw();
}

/* ─── Stats pulse on vidIQ update ─────────────────────────────────────────── */
function pulseSidebarStats() {
  const panel = document.getElementById('channelStats');
  if (!panel) return;
  panel.classList.remove('stats-pulse');
  void panel.offsetWidth; // reflow to restart animation
  panel.classList.add('stats-pulse');
  setTimeout(() => panel.classList.remove('stats-pulse'), 1000);
}