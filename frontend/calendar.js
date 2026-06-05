/* ==========================================================================
   CONTENTIX CALENDAR VIEW — App JS
   ========================================================================== */

// ─── State ──────────────────────────────────────────────────────────────────
let currentDate = new Date();
let currentView = 'month'; // 'month' | 'week'
let selectedDay = null;
let weekIndex = 0; // 0 = first week of month, 1 = second week, ...

// Note: allCards is shared from kanban.js (loaded there and set as global)

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Calendar is rendered when user clicks on calendar nav item
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function getWeeksInMonth(year, month, startDay) {
  // Returns array of weeks, each week is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] dates
  const weeks = [];
  const firstDate = new Date(year, month, 1 - (startDay - 1));
  let current = new Date(firstDate);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function getKalenderwoche(date) {
  // ISO week number
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── Render Calendar ─────────────────────────────────────────────────────────
async function renderCalendar() {
  const container = document.getElementById('calendarContent');
  if (!container) return;

  // Load all cards for date filtering
  try {
    await loadAllCards();
  } catch (_) {}

  container.innerHTML = `
    <div class="calendar-container">
      <div class="calendar-header">
        <div class="calendar-nav">
          <button class="calendar-nav__btn" onclick="prevCalendarPeriod()">‹</button>
          <button class="calendar-nav__btn calendar-nav__btn--today" onclick="goToToday()">Heute</button>
          <button class="calendar-nav__btn" onclick="nextCalendarPeriod()">›</button>
        </div>
        <h2 class="calendar-title" id="calendarTitle"></h2>
        <div class="calendar-views">
          <button class="calendar-view-btn ${currentView === 'month' ? 'calendar-view-btn--active' : ''}" onclick="setCalendarView('month')">Monat</button>
          <button class="calendar-view-btn ${currentView === 'week' ? 'calendar-view-btn--active' : ''}" onclick="setCalendarView('week')">Woche</button>
        </div>
      </div>
      <div id="calendarGrid"></div>
      <div id="calendarDayDetail"></div>
    </div>
  `;

  renderCalendarGrid(getAllCards() || []);
}

function renderCalendarGrid(allCards) {
  const grid = document.getElementById('calendarGrid');
  const title = document.getElementById('calendarTitle');
  
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  
  // Get first day of month and total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay() || 7; // Monday = 1
  const totalDays = lastDay.getDate();
  
  // Previous month days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  
  if (currentView === 'month') {
    title.textContent = `${monthNames[month]} ${year}`;
    renderMonthView(grid, year, month, startDay, totalDays, prevMonthLastDay, allCards);
  } else {
    // Week view: show the week identified by weekIndex
    const weeks = getWeeksInMonth(year, month, startDay);
    const safeIdx = Math.max(0, Math.min(weekIndex, weeks.length - 1));
    const week = weeks[safeIdx];
    const firstDate = week[0];
    const lastDate = week[6];
    const kw = getKalenderwoche(firstDate);
    const startStr = `${firstDate.getDate()}. ${monthNames[firstDate.getMonth()].substring(0,3)}`;
    const endStr = `${lastDate.getDate()}. ${monthNames[lastDate.getMonth()].substring(0,3)} ${lastDate.getFullYear()}`;
    title.textContent = `KW ${kw} — ${startStr} – ${endStr}`;
    renderWeekView(grid, year, month, weeks, weekIndex, allCards);
  }
}

function renderMonthView(grid, year, month, startDay, totalDays, prevMonthLastDay, allCards) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();
  
  // Days of week header
  const daysOfWeek = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  
  let html = `<div class="calendar-week-header">${daysOfWeek.map(d => `<div class="calendar-week-header__day">${d}</div>`).join('')}</div>`;
  html += '<div class="calendar-month">';
  
  // Previous month days
  for (let i = startDay - 1; i >= 1; i--) {
    const day = prevMonthLastDay - i + 1;
    html += renderCalendarDay(year, month - 1, day, true, today, isCurrentMonth, todayDate, allCards);
  }
  
  // Current month days
  for (let day = 1; day <= totalDays; day++) {
    html += renderCalendarDay(year, month, day, false, today, isCurrentMonth, todayDate, allCards);
  }
  
  // Next month days
  const totalCells = startDay - 1 + totalDays;
  const remainingCells = 7 - (totalCells % 7);
  if (remainingCells < 7) {
    for (let day = 1; day <= remainingCells; day++) {
      html += renderCalendarDay(year, month + 1, day, true, today, isCurrentMonth, todayDate, allCards);
    }
  }
  
  html += '</div>';
  grid.innerHTML = html;
}

function renderCalendarDay(year, month, day, isOtherMonth, today, isCurrentMonth, todayDate, allCards) {
  // Normalize month/year for other months
  if (month < 0) { month = 11; year--; }
  if (month > 11) { month = 0; year++; }
  
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isToday = !isOtherMonth && isCurrentMonth && day === todayDate;
  
  // Get events for this day
  const events = allCards.filter(c => {
    if (!c.planned_date && !c.published_date) return false;
    const eventDate = c.planned_date ? c.planned_date.split('T')[0] : c.published_date.split('T')[0];
    return eventDate === dateStr;
  });
  
  // Sort by time
  events.sort((a, b) => {
    const ta = a.planned_date || '';
    const tb = b.planned_date || '';
    return ta.localeCompare(tb);
  });
  
  // Group into 3 time buckets
  const buckets = { morning: [], afternoon: [], evening: [] };
  
  for (const e of events) {
    const timeSrc = e.planned_date || e.published_date || '';
    const timePart = timeSrc.split('T')[1];
    const hour = timePart ? parseInt(timePart.split(':')[0], 10) : 0;
    if (hour < 12) buckets.morning.push(e);
    else if (hour < 18) buckets.afternoon.push(e);
    else buckets.evening.push(e);
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  const isPast = dateStr < todayStr;
  const dow = new Date(year, month, day).getDay();
  const isWeekend = dow === 0 || dow === 6; // Sun=0, Sat=6
  const dayClass = isOtherMonth ? 'calendar-day--other-month' : '';
  const todayClass = isToday ? 'calendar-day--today' : '';
  const weekendClass = isWeekend ? 'calendar-day--weekend' : '';
  
  function renderBucket(label, evs) {
    if (evs.length === 0) return '';
    return `
      <div class="time-bucket">
        <div class="time-bucket__label">${label}</div>
        ${evs.map(e => {
          const statusClass = e.status === 'published' ? 'published' : e.status === 'recording' ? 'recording' : 'planned';
          const icon = e.status === 'published' ? '📺' : e.status === 'recording' ? '🎬' : '📋';
          // vidIQ-sourced = has a video_id from YouTube (published + has video_id)
          const isVidiq = e.status === 'published' && e.video_id;
          const isDraggable = e.status !== 'published';
          const draggableAttr = isDraggable
            ? `draggable="true" ondragstart="handleCardDragStart(event, '${e.id}')" ondragend="handleCardDragEnd(event)"`
            : 'draggable="false"';
          const cardClass = isPast ? 'calendar-event--past' : 'calendar-event--' + statusClass;
          const dateSrc = e.planned_date || e.published_date || '';
          const timeStr = dateSrc.split('T')[1]?.substring(0, 5) || '';
          const dateStr = dateSrc.split('T')[0]?.substring(5) || ''; // "MM-DD" -> "TT/MM"
          const isNix = (e.owner || 'dirk') === 'nix';
          const authorIcon = isNix ? '🐧' : '🎬';
          const authorName = isNix ? 'Nix' : 'Dirk';
          return `<div class="calendar-event ${cardClass}" ${draggableAttr} onclick="event.stopPropagation(); openCardFromCalendar('${e.id}')">
            <span class="calendar-event__time">${timeStr}</span>
            <span class="calendar-event__date">${dateStr}</span>
            <span class="calendar-event__title">${isVidiq ? '🔴 ' : '📋 '}${escapeHtml(e.title)}</span>
            <span class="calendar-event__author" title="Owner: ${authorName}">${authorIcon}</span>
          </div>`;
        }).join('')}
      </div>`;
  }
  
  return `
  <div class="calendar-day ${dayClass} ${todayClass} ${weekendClass}" data-date="${dateStr}"
       ondragover="handleMonthDayDragOver(event)"
       ondrop="handleMonthDayDrop(event, '${dateStr}')"
       onclick="selectCalendarDay(escapeHtml('${dateStr}'))">
    <div class="calendar-day__number">${day}</div>
    <div class="calendar-day__events">
      ${renderBucket('8–12 Uhr', buckets.morning)}
      ${renderBucket('12–18 Uhr', buckets.afternoon)}
      ${renderBucket('nach 18 Uhr', buckets.evening)}
    </div>
  </div>`;
}

function renderWeekView(grid, year, month, weeks, weekIndex, allCards) {
  const daysOfWeek = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const today = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  const safeWeekIdx = Math.max(0, Math.min(weekIndex, weeks.length - 1));
  const week = weeks[safeWeekIdx];
  const firstDate = week[0];
  const lastDate = week[6];

  // ── Header ────────────────────────────────────────────────────────────────
  let html = '<div class="calendar-week-header">';
  html += daysOfWeek.map((d, i) => {
    const dow = week[i];
    const dowStr = dow.getFullYear() + '-' + String(dow.getMonth()+1).padStart(2,'0') + '-' + String(dow.getDate()).padStart(2,'0');
    const isToday = dowStr === todayStr;
    const isWeekend = i >= 5;
    return `<div class="calendar-week-header__day ${isToday ? 'calendar-week-header__day--today' : ''} ${isWeekend ? 'calendar-week-header__day--weekend' : ''}">
      <span class="day-name">${d}</span>
      <span class="day-num">${dow.getDate()}</span>
    </div>`;
  }).join('');
  html += '</div>';

  // ── Group cards by day + bucket ──────────────────────────────────────────
  const BUCKETS = [
    { key: 'morning',   label: '8–12 Uhr',    maxHour: 12 },
    { key: 'afternoon', label: '12–18 Uhr',   maxHour: 18 },
    { key: 'evening',   label: 'nach 18 Uhr', maxHour: 24 },
  ];

  const dayEvents = week.map((dayDate, dayIdx) => {
    const dateStr = dayDate.getFullYear() + '-' + String(dayDate.getMonth()+1).padStart(2,'0') + '-' + String(dayDate.getDate()).padStart(2,'0');
    const evs = (allCards || []).filter(c => {
      if (!c.planned_date && !c.published_date) return false;
      const src = c.planned_date || c.published_date;
      return src.split('T')[0] === dateStr;
    });
    // Sort by time
    evs.sort((a, b) => {
      const ta = a.planned_date || a.published_date || '';
      const tb = b.planned_date || b.published_date || '';
      return ta.localeCompare(tb);
    });
    // Bucket by hour
    const bucketed = { morning: [], afternoon: [], evening: [] };
    for (const e of evs) {
      const src = e.planned_date || e.published_date || '';
      const hour = src.split('T')[1] ? parseInt(src.split('T')[1].split(':')[0], 10) : 0;
      if (hour < 12) bucketed.morning.push(e);
      else if (hour < 18) bucketed.afternoon.push(e);
      else bucketed.evening.push(e);
    }
    return { dateStr, isPast: dateStr < todayStr, isWeekend: dayIdx >= 5, bucketed };
  });

  // ── 3 time rows ──────────────────────────────────────────────────────────
  html += '<div class="calendar-week-body">';
  for (const bucket of BUCKETS) {
    html += `<div class="week-bucket-row">`;
    html += `<div class="week-bucket-row__label">${bucket.label}</div>`;
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const day = dayEvents[dayIdx];
      const evs = day.bucketed[bucket.key];
      const isWeekend = day.isWeekend;
      const isToday = day.dateStr === todayStr;
      html += `<div class="week-day-col ${isWeekend ? 'week-day-col--weekend' : ''} ${isToday ? 'week-day-col--today' : ''}" data-date="${day.dateStr}" data-bucket="${bucket.key}" ondragover="handleDayColDragOver(event)" ondrop="handleDayColDrop(event, '${day.dateStr}', '${bucket.key}')" onclick="selectCalendarDay('${day.dateStr}')">`;
      if (evs.length === 0) {
        html += `<div class="week-day-col__empty">–</div>`;
      } else {
        html += evs.map(e => {
          const statusClass = e.status === 'published' ? 'published' : e.status === 'recording' ? 'recording' : 'planned';
          const icon = e.status === 'published' ? '📺' : e.status === 'recording' ? '🎬' : '📋';
          const cardClass = day.isPast ? 'calendar-event--past' : 'calendar-event--' + statusClass;
          const dateSrc = e.planned_date || e.published_date || '';
          const timeStr = dateSrc.split('T')[1]?.substring(0, 5) || '';
          const dateStr = dateSrc.split('T')[0]?.substring(5) || ''; // "MM-DD" -> "TT/MM"
          const isDraggable = e.status !== 'published';
          const dragAttrs = isDraggable
            ? `draggable="true" ondragstart="handleCardDragStart(event, '${e.id}')" ondragend="handleCardDragEnd(event)"`
            : 'draggable="false"';
          const isNix = (e.owner || 'dirk') === 'nix';
          const authorIcon = isNix ? '🐧' : '🎬';
          const authorName = isNix ? 'Nix' : 'Dirk';
          return `<div class="calendar-week-card ${cardClass}" ${dragAttrs} data-card-id="${e.id}" onclick="event.stopPropagation(); openCardFromCalendar('${e.id}')">
            <span class="calendar-event__time">${timeStr}</span>
            <span class="calendar-event__date">${dateStr}</span>
            <span class="calendar-event__title">${icon} ${escapeHtml(e.title)}</span>
            <span class="calendar-event__author" title="Owner: ${authorName}">${authorIcon}</span>
          </div>`;
        }).join('');
      }
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  grid.innerHTML = html;
}

// ─── Navigation ─────────────────────────────────────────────────────────────
async function prevCalendarPeriod() {
  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() - 1);
    weekIndex = 0;
  } else {
    if (weekIndex > 0) {
      weekIndex--;
    } else {
      // Go to last week of previous month
      currentDate.setMonth(currentDate.getMonth() - 1);
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const startDay = firstDay.getDay() || 7;
      const weeks = getWeeksInMonth(year, month, startDay);
      weekIndex = weeks.length - 1;
    }
  }
  try {
    await loadAllCards();
    renderCalendarGrid(getAllCards() || []);
  } catch(err) {
    showToast && showToast("Fehler beim Laden", "error");
  }
}

async function nextCalendarPeriod() {
  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() + 1);
    weekIndex = 0;
  } else {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay() || 7;
    const weeks = getWeeksInMonth(year, month, startDay);
    
    if (weekIndex < weeks.length - 1) {
      weekIndex++;
    } else {
      currentDate.setMonth(currentDate.getMonth() + 1);
      weekIndex = 0;
    }
  }
  loadAllCards().then(cards => renderCalendarGrid(cards));
}

async function goToToday() {
  currentDate = new Date();
  if (currentView === 'week') {
    // Find the week containing today by date comparison
    const todayStr = currentDate.toISOString().split('T')[0];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay() || 7;
    const weeks = getWeeksInMonth(year, month, startDay);
    weekIndex = 0;
    for (let i = 0; i < weeks.length; i++) {
      const weekStart = weeks[i][0].toISOString().split('T')[0];
      const weekEnd = weeks[i][6].toISOString().split('T')[0];
      if (todayStr >= weekStart && todayStr <= weekEnd) {
        weekIndex = i;
        break;
      }
    }
  }
  document.querySelectorAll('.calendar-view-btn').forEach(btn => {
    btn.classList.toggle('calendar-view-btn--active', btn.textContent.toLowerCase().includes(currentView));
  });
  await loadAllCards();
  renderCalendarGrid(getAllCards());
}

function setCalendarView(view) {
  const wasMonth = currentView;
  currentView = view;
  
  // If switching to week view, find the correct week index for current date
  if (view === 'week') {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    
    // Check if currentDate is in same month as today
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    
    if (todayYear === currentYear && todayMonth === currentMonth) {
      // Same month - find which week index contains today's date
      const firstDay = new Date(currentYear, currentMonth, 1);
      const startDay = firstDay.getDay() || 7;
      const weeks = getWeeksInMonth(currentYear, currentMonth, startDay);
      
      // Find which week contains the current day of month
      const todayDay = currentDate.getDate();
      weekIndex = Math.floor((todayDay + startDay - 2) / 7);
      weekIndex = Math.max(0, Math.min(weekIndex, weeks.length - 1));
    } else {
      // Different month - default to first week
      weekIndex = 0;
    }
  }
  
  loadAllCards().then(cards => renderCalendarGrid(cards));
  
  // Update buttons
  document.querySelectorAll('.calendar-view-btn').forEach(btn => {
    btn.classList.toggle('calendar-view-btn--active', btn.textContent.toLowerCase().includes(view));
  });
}

function closeCalendarDayDetail() {
  document.getElementById('calendarDayDetail').innerHTML = '';
}

// ─── Day Selection ───────────────────────────────────────────────────────────
async function selectCalendarDay(dateStr) {
  selectedDay = dateStr;
  
  // Highlight selected day
  document.querySelectorAll('.calendar-day').forEach(el => el.classList.remove('calendar-day--selected'));
  document.querySelector(`.calendar-day[data-date="${dateStr}"]`)?.classList.add('calendar-day--selected');
  
  // Load cards for this day
  const dayEvents = (getAllCards() || []).filter(c => {
    if (!c.planned_date && !c.published_date) return false;
    const eventDate = c.planned_date ? c.planned_date.split('T')[0] : c.published_date.split('T')[0];
    return eventDate === dateStr;
  });
  
  const detail = document.getElementById('calendarDayDetail');
  if (dayEvents.length === 0) {
    detail.innerHTML = '';
    return;
  }
  
  const date = new Date(dateStr + 'T12:00:00');
  const formattedDate = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  
  detail.innerHTML = `
  <div class="calendar-day-detail">
    <div class="calendar-day-detail__header">
      <h3 class="calendar-day-detail__title">📅 ${formattedDate}</h3>
      <button class="calendar-day-detail__close" onclick="document.getElementById('calendarDayDetail').innerHTML=''">×</button>
    </div>
    <div class="calendar-day-detail__cards">
      ${dayEvents.map(e => {
        const isNix = (e.owner || 'dirk') === 'nix';
        const authorIcon = isNix ? '🐧' : '🎬';
        const authorName = isNix ? 'Nix' : 'Dirk';
        const dateSrc = e.planned_date || e.published_date || '';
        const dateStr = dateSrc.split('T')[0]?.substring(5) || ''; // "MM-DD" -> "TT/MM"
        return `
      <div class="kanban-card" data-id="${e.id}" onclick="openCardFromCalendar('${e.id}')">
        <div class="kanban-card__title">${escapeHtml(e.title)}</div>
        <div class="kanban-card__author">
          <span class="kanban-card__author-icon">${authorIcon}</span>
          <span class="kanban-card__author-name">${authorName}</span>
          ${dateStr ? `<span class="kanban-card__date">📅 ${dateStr}</span>` : ''}
        </div>
        <div class="kanban-card__meta">
          ${e.tags ? e.tags.slice(0, 3).map(t => `<span class="kanban-card__tag">${escapeHtml(t)}</span>`).join('') : ''}
        </div>
        ${e.status === 'published' && e.nix_comment ? `<div class="nix-research">
          <div class="nix-research__header">🐧 Nix sagt:</div>
          <div class="nix-research__text">${escapeHtml(truncate(e.nix_comment, 100))}</div>
        </div>` : ''}
      </div>`;
      }).join('')}
    </div>
  </div>
  `;
}

function openCardFromCalendar(cardId, prefillDate = null) {
  // Open card modal on top of whatever view we're in (calendar, ideas, etc.)
  // Keep current view active, just show the modal
  loadAllCards().then(() => {
    openCardModal(cardId, 'ideas', prefillDate);
  });
}

function openCardFromCalendarWithDate(cardId, targetDate) {
  // Combine date from drop target + time from existing card (or default 10:00)
  const cards = getAllCards() || [];
  const card = cards.find(c => c.id === cardId);
  let timeStr = '10:00';
  if (card && card.planned_date) {
    timeStr = card.planned_date.split('T')[1]?.substring(0, 5) || '10:00';
  }
  const prefillDate = `${targetDate}T${timeStr}:00`;
  openCardFromCalendar(cardId, prefillDate);
}

/* ─── Drag & Drop ──────────────────────────────────────────────────────────── */
let _draggedCardId = null;

function handleCardDragStart(event, cardId) {
  _draggedCardId = cardId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', cardId);
  // Ghost-Style auf der gezogenen Karte
  event.target.classList.add('calendar-week-card--dragging');
}

function handleCardDragEnd(event) {
  event.target.classList.remove('calendar-week-card--dragging');
  _draggedCardId = null;
  // Alle Drop-Highlights aufräumen
  document.querySelectorAll('.week-day-col--drop-target').forEach(el => {
    el.classList.remove('week-day-col--drop-target');
  });
  document.querySelectorAll('.calendar-day--drop-target').forEach(el => {
    el.classList.remove('calendar-day--drop-target');
  });
}

function handleMonthDayDragOver(event) {
  event.preventDefault();
  if (_draggedCardId) {
    // Clear all drop-targets first, then highlight only the current day
    document.querySelectorAll('.calendar-day--drop-target').forEach(el =>
      el.classList.remove('calendar-day--drop-target'));
    event.currentTarget.classList.add('calendar-day--drop-target');
  }
}

function handleMonthDayDrop(event, targetDate) {
  event.preventDefault();
  event.currentTarget.classList.remove('calendar-day--drop-target');

  const cardId = _draggedCardId || event.dataTransfer.getData('text/plain');
  if (!cardId) return;

  const cards = getAllCards() || [];
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  // Only allow non-published cards
  if (card.status === 'published') return;

  // Open modal with pre-filled date (modal sets dataset.column for new card, not used here)
  openCardFromCalendarWithDate(cardId, targetDate);
}

function handleDayColDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  if (_draggedCardId) {
    event.currentTarget.classList.add('week-day-col--drop-target');
  }
}

function handleDayColDrop(event, targetDate, targetBucket) {
  event.preventDefault();
  event.currentTarget.classList.remove('week-day-col--drop-target');

  const cardId = _draggedCardId || event.dataTransfer.getData('text/plain');
  if (!cardId) return;

  const cards = getAllCards() || [];
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  if (card.status === 'published') return;

  // Bucket-Zeit setzen (Morgen=10:00, Nachmittag=14:00, Abend=20:00)
  const bucketTimes = { morning: '10:00', afternoon: '14:00', evening: '20:00' };
  const timeStr = bucketTimes[targetBucket] || '10:00';
  const newPlannedDate = `${targetDate}T${timeStr}:00`;
  
  // Optimistisch: sofort neu rendern
  const oldPlannedDate = card.planned_date;
  card.planned_date = newPlannedDate;
  renderCalendarGrid(getAllCards());
  
  // API Call
  fetch(`/api/videos/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planned_date: newPlannedDate })
  }).then(res => {
    if (!res.ok) throw new Error('API error');
    showToast && showToast('Video verschoben', 'success');
  }).catch(err => {
    // Zurückrollen
    card.planned_date = oldPlannedDate;
    renderCalendarGrid(getAllCards());
    showToast && showToast('Fehler beim Verschieben', 'error');
  });
}

/* ─── Helpers via utils.js ────────────────────────────────────────────────── */
