const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const SLOTS = [
  ['08:00', '08:45'], ['08:45', '09:30'],
  ['09:40', '10:25'], ['10:25', '11:10'],
  ['11:20', '12:05'], ['12:05', '12:50'],
  ['12:50', '13:35'], ['13:35', '14:20'],
  ['14:30', '15:15'], ['15:15', '16:00'],
  ['16:10', '16:55'], ['16:55', '17:40'],
  ['17:50', '18:35'], ['18:35', '19:20'],
  ['19:30', '20:15'],
];

const SLOT_STARTS = SLOTS.map(([s]) => toMins(s));
const SLOT_ENDS   = SLOTS.map(([, e]) => toMins(e));

function toMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekBounds(offset) {
  const now = new Date();
  const mon = new Date(now);
  const day = now.getDay();
  mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  const end = new Date(mon);
  end.setDate(mon.getDate() + 7);
  return { from: Math.floor(mon / 1000), to: Math.floor(end / 1000), date: mon };
}

function getSemesterBounds() {
  const now = new Date();
  const year = now.getFullYear();
  let begin, end;
  if (now.getMonth() >= 7) { // Aug-Dec (month is 0-indexed)
    begin = new Date(year, 7, 1);    // Aug 1
    end = new Date(year + 1, 1, 28); // Feb 28 next year
  } else {
    begin = new Date(year, 1, 1);    // Feb 1
    end = new Date(year, 6, 31, 23, 59, 59); // Jul 31
  }
  return { from: Math.floor(begin / 1000), to: Math.floor(end / 1000) };
}

function formatWeekLabel(date, offset) {
  const mon = new Date(date);
  const sun = new Date(date);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
  const labels = { '-1': 'Letzte Woche', '0': 'Diese Woche', '1': 'Nächste Woche' };
  const prefix = labels[offset];
  return prefix ? `${prefix} (${fmt(mon)}–${fmt(sun)})` : `${fmt(mon)}–${fmt(sun)}`;
}

function matchSlot(starts, date) {
  const m = date.getHours() * 60 + date.getMinutes();
  return starts.findIndex(s => Math.abs(s - m) <= 5);
}

// --- Semester event cache ---
let allEvents = [];

async function loadAllEvents() {
  const { from, to } = getSemesterBounds();
  const res = await fetch(`/events?from_ts=${from}&to_ts=${to}`);
  allEvents = await res.json();
}

function eventsForWeek(weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return dayKey(d);
  });
  const daySet = new Set(days);
  return allEvents.filter(e => daySet.has(dayKey(new Date(e.start))));
}

function timeToRow(minutes) {
  if (minutes <= SLOT_STARTS[0]) return 0;
  if (minutes >= SLOT_ENDS[SLOT_ENDS.length - 1]) return SLOTS.length;
  for (let i = 0; i < SLOTS.length; i++) {
    if (minutes >= SLOT_STARTS[i] && minutes <= SLOT_ENDS[i]) {
      return i + (minutes - SLOT_STARTS[i]) / (SLOT_ENDS[i] - SLOT_STARTS[i]);
    }
    if (i < SLOTS.length - 1 && minutes > SLOT_ENDS[i] && minutes < SLOT_STARTS[i + 1]) {
      const gapFrac = (minutes - SLOT_ENDS[i]) / (SLOT_STARTS[i + 1] - SLOT_ENDS[i]);
      return i + 1 + gapFrac * 0; // snap to boundary between slots
    }
  }
  return SLOTS.length;
}

function buildHTML(offset) {
  const { date: weekStart } = getWeekBounds(offset);
  const events = eventsForWeek(weekStart);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { date: d, key: dayKey(d) };
  });

  const placed = [];
  const covered = new Set();

  for (const e of events) {
    if (e.custom) continue;
    const start = new Date(e.start);
    const end = new Date(e.end);
    const dayIdx = days.findIndex(d => d.key === dayKey(start));
    const startSlot = matchSlot(SLOT_STARTS, start);
    if (dayIdx === -1 || startSlot === -1) continue;
    const endSlot = matchSlot(SLOT_ENDS, end);
    const lastSlot = endSlot !== -1 ? endSlot : startSlot;
    placed.push({ e, dayIdx, startSlot, lastSlot });
    for (let s = startSlot; s <= lastSlot; s++) covered.add(`${s},${dayIdx}`);
  }

  const today = dayKey(new Date());
  let html = '<div class="timetable">';
  html += '<div class="cell" style="grid-row:1;grid-column:1"></div>';

  for (let d = 0; d < 7; d++) {
    const { date, key } = days[d];
    const label = DAYS[date.getDay() === 0 ? 6 : date.getDay() - 1];
    html += `<div class="cell day-header${key === today ? ' today' : ''}" style="grid-row:1;grid-column:${d + 2}">${label}<br>${date.getDate()}</div>`;
  }

  for (let s = 0; s < SLOTS.length; s++) {
    html += `<div class="cell time-label" style="grid-row:${s + 2};grid-column:1">${SLOTS[s][0]}</div>`;
  }

  for (const { e, dayIdx, startSlot, lastSlot } of placed) {
    const span = lastSlot - startSlot + 1;
    const isToday = days[dayIdx].key === today;
    html += `<div class="cell event-cell" style="grid-row:${startSlot + 2}/span ${span};grid-column:${dayIdx + 2}" data-event='${JSON.stringify(e).replace(/'/g, "&#39;")}'>
      <div class="event${isToday ? ' today' : ''}">
        <div class="event-abbr">${e.summary.slice(0, 3).toUpperCase()}${e.location && e.location.toLowerCase().includes('webinar') ? '<span class="webinar-icon material-symbols-outlined">videocam</span>' : ''}</div>
        <div class="event-time">${SLOTS[startSlot][0]}<br>${SLOTS[lastSlot][1]}</div>
      </div>
    </div>`;
  }

  for (let s = 0; s < SLOTS.length; s++) {
    for (let d = 0; d < 7; d++) {
      if (!covered.has(`${s},${d}`)) {
        html += `<div class="cell empty-cell" data-slot="${s}" data-day="${d}" style="grid-row:${s + 2};grid-column:${d + 2}"></div>`;
      }
    }
  }

  return html + '</div>';
}

function placeCustomEvents(panel, offset) {
  const timetable = panel.querySelector('.timetable');
  if (!timetable) return;

  const { date: weekStart } = getWeekBounds(offset);
  const customs = eventsForWeek(weekStart).filter(e => e.custom);
  if (customs.length === 0) return;

  const timeLabels = timetable.querySelectorAll('.cell.time-label');
  if (timeLabels.length === 0) return;
  const gridTop = timeLabels[0].offsetTop;
  const rowHeight = timeLabels[0].offsetHeight;

  const dayHeaders = timetable.querySelectorAll('.cell.day-header');
  const today = dayKey(new Date());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return dayKey(d);
  });

  const pad = n => String(n).padStart(2, '0');

  for (const e of customs) {
    const start = new Date(e.start);
    const end = new Date(e.end);
    const startMins = start.getHours() * 60 + start.getMinutes();
    const endMins = end.getHours() * 60 + end.getMinutes();
    const dayIdx = days.indexOf(dayKey(start));
    if (dayIdx === -1) continue;
    const header = dayHeaders[dayIdx];
    if (!header) continue;

    const topRow = timeToRow(startMins);
    const bottomRow = timeToRow(endMins);
    const top = gridTop + topRow * rowHeight;
    const height = Math.max((bottomRow - topRow) * rowHeight, rowHeight * 0.5);

    const isToday = days[dayIdx] === today;
    const div = document.createElement('div');
    div.className = 'custom-overlay' + (isToday ? ' today' : '');
    div.style.top = top + 'px';
    div.style.left = header.offsetLeft + 'px';
    div.style.width = header.offsetWidth + 'px';
    div.style.height = height + 'px';
    div.dataset.event = JSON.stringify(e);

    const fmtTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    div.innerHTML = `
      <div class="event-abbr">${e.summary.slice(0, 3).toUpperCase()}</div>
      <div class="event-time">${fmtTime(startMins)}<br>${fmtTime(endMins)}</div>
    `;

    div.addEventListener('click', () => showDetail(e));
    timetable.appendChild(div);
  }
}

function updateTimeIndicator() {
  const timetable = outCurr.querySelector('.timetable');
  if (!timetable) return;

  timetable.querySelectorAll('.col-highlight, .time-line').forEach(el => el.remove());

  const todayHeader = outCurr.querySelector('.cell.day-header.today');
  if (!todayHeader) return;

  const colLeft  = todayHeader.offsetLeft;
  const colWidth = todayHeader.offsetWidth;

  const highlight = document.createElement('div');
  highlight.className = 'col-highlight';
  highlight.style.left  = colLeft + 'px';
  highlight.style.width = colWidth + 'px';
  timetable.appendChild(highlight);

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (nowMins < SLOT_STARTS[0] || nowMins > SLOT_ENDS[SLOT_ENDS.length - 1]) return;

  let slotIdx = SLOTS.length - 1;
  for (let s = 0; s < SLOTS.length; s++) {
    if (nowMins < SLOT_ENDS[s]) { slotIdx = s; break; }
  }

  const frac = Math.max(0, Math.min(1, (nowMins - SLOT_STARTS[slotIdx]) / (SLOT_ENDS[slotIdx] - SLOT_STARTS[slotIdx])));
  const slotCell = timetable.querySelectorAll('.cell.time-label')[slotIdx];
  if (!slotCell) return;

  const y = slotCell.offsetTop + frac * slotCell.offsetHeight;
  const line = document.createElement('div');
  line.className = 'time-line';
  line.style.top   = y + 'px';
  line.style.left  = colLeft + 'px';
  line.style.width = colWidth + 'px';
  timetable.appendChild(line);
}

function showDetail(e) {
  const start = new Date(e.start);
  const end = new Date(e.end);
  const fmt = d => d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const dateFmt = start.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const modal = document.getElementById('detail-modal');
  modal.querySelector('.detail-title').textContent = e.summary;
  modal.querySelector('.detail-class').textContent = e.class || '';
  modal.querySelector('.detail-lecturer').textContent = e.lecturer || '';
  modal.querySelector('.detail-date').textContent = dateFmt;
  modal.querySelector('.detail-time').textContent = `${fmt(start)} – ${fmt(end)}`;
  modal.querySelector('.detail-location').textContent = e.location || '–';

  const delBtn = modal.querySelector('.detail-delete');
  if (e.custom) {
    delBtn.style.display = '';
    delBtn.onclick = async () => {
      await fetch(`/custom-events/${e.uid}`, { method: 'DELETE' });
      modal.classList.remove('visible');
      await loadAllEvents();
      renderWeeks();
    };
  } else {
    delBtn.style.display = 'none';
  }

  modal.classList.add('visible');
}

let tapStart = null;
document.addEventListener('touchstart', e => {
  tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!tapStart) return;
  const dx = e.changedTouches[0].clientX - tapStart.x;
  const dy = e.changedTouches[0].clientY - tapStart.y;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;

  const modal = document.getElementById('detail-modal');
  if (modal.classList.contains('visible')) {
    if (!e.target.closest('.detail-content') || e.target.closest('.detail-close')) {
      modal.classList.remove('visible');
    }
    return;
  }

  const cell = e.target.closest('.event-cell[data-event]') || e.target.closest('.custom-overlay[data-event]');
  if (cell) showDetail(JSON.parse(cell.dataset.event));
}, { passive: true });

let weekOffset = 0;

const track   = document.getElementById('track');
const outPrev = document.getElementById('out-prev');
const outCurr = document.getElementById('out-curr');
const outNext = document.getElementById('out-next');
const wrap    = document.getElementById('slide-wrap');

function setTrack(y, animated) {
  track.style.transition = animated ? 'transform 0.28s ease' : 'none';
  track.style.transform  = `translateY(${y}px)`;
}

function panelH() {
  return wrap.clientHeight;
}

function renderWeeks() {
  document.getElementById('week-label').textContent = formatWeekLabel(getWeekBounds(weekOffset).date, weekOffset);
  outPrev.innerHTML = buildHTML(weekOffset - 1);
  outCurr.innerHTML = buildHTML(weekOffset);
  outNext.innerHTML = buildHTML(weekOffset + 1);
  const h = panelH() + 'px';
  outPrev.style.height = h;
  outCurr.style.height = h;
  outNext.style.height = h;
  setTrack(-panelH(), false);
  placeCustomEvents(outPrev, weekOffset - 1);
  placeCustomEvents(outCurr, weekOffset);
  placeCustomEvents(outNext, weekOffset + 1);
  updateTimeIndicator();
}

async function render() {
  await loadAllEvents();
  renderWeeks();
}

setInterval(updateTimeIndicator, 60_000);
render();

let touchStartY = null;
let baseY = 0;
let touchMode = null;
let swipeTimeout = null;
let lastSwipeDir = 0;

function flushPendingSwipe() {
  if (swipeTimeout) {
    clearTimeout(swipeTimeout);
    swipeTimeout = null;
    renderWeeks();
  }
}

document.addEventListener('touchstart', e => {
  if (swipeTimeout) {
    // mid-animation touch: immediately chain another swipe in the same direction
    const dir = lastSwipeDir;
    clearTimeout(swipeTimeout);
    swipeTimeout = null;
    renderWeeks();               // snap to current weekOffset
    weekOffset += dir;           // advance again
    setTrack(-panelH() - dir * panelH(), true);  // animate out
    swipeTimeout = setTimeout(() => { swipeTimeout = null; renderWeeks(); }, 285);
    touchStartY = null;
    touchMode = null;
    return;
  }
  touchStartY = e.touches[0].clientY;
  const panel = e.target.closest('#out-prev, #out-curr, #out-next');
  if (panel && panel.scrollHeight > panel.clientHeight) {
    touchMode = 'scroll';
  } else {
    touchMode = 'swipe';
    baseY = -panelH();
    setTrack(baseY, false);
  }
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (touchStartY === null) return;
  const dy = e.touches[0].clientY - touchStartY;

  if (touchMode === 'scroll') {
    const panel = e.target.closest('#out-prev, #out-curr, #out-next');
    if (panel) {
      const atTop = panel.scrollTop <= 0;
      const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        e.preventDefault();
      }
    }
  } else {
    e.preventDefault();
    setTrack(baseY + dy, false);
  }
}, { passive: false });

document.addEventListener('touchend', e => {
  if (touchStartY === null) return;
  const dy = e.changedTouches[0].clientY - touchStartY;
  touchStartY = null;

  if (touchMode === 'swipe' && Math.abs(dy) > 60) {
    const dir = dy > 0 ? -1 : 1;
    lastSwipeDir = dir;
    weekOffset += dir;
    setTrack(baseY - dir * panelH(), true);
    swipeTimeout = setTimeout(() => { swipeTimeout = null; renderWeeks(); }, 285);
  } else if (touchMode === 'swipe') {
    setTrack(baseY, true);
  }
  touchMode = null;
}, { passive: true });

// --- Log view ---
const logView = document.getElementById('log-view');
const logList = document.getElementById('log-list');

async function loadLogs() {
  const res = await fetch('/logs');
  const logs = await res.json();
  logList.innerHTML = logs.length === 0
    ? '<div style="color:#555;text-align:center;margin-top:2rem">no pulls yet</div>'
    : logs.slice().reverse().map(l => {
        const d = new Date(l.time);
        const time = d.toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div class="log-entry">
          <span class="log-time">${time}</span>
          <span class="log-status ${l.changed ? 'changed' : 'unchanged'}">${l.changed ? 'changed' : 'no change'}</span>
        </div>`;
      }).join('');
}

document.getElementById('log-btn').addEventListener('click', () => {
  logView.classList.remove('hidden');
  loadLogs();
});

document.getElementById('log-back').addEventListener('click', () => {
  logView.classList.add('hidden');
});

document.getElementById('theme-switch').addEventListener('change', e => {
  document.body.classList.toggle('light', e.target.checked);
  localStorage.setItem('theme', e.target.checked ? 'light' : 'dark');
});

if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light');
  document.getElementById('theme-switch').checked = true;
}

document.getElementById('log-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('log-refresh');
  btn.classList.add('spinning');
  await fetch('/refresh', { method: 'POST' });
  btn.classList.remove('spinning');
  loadLogs();
  render();
});

// --- Long-press to add custom event ---
let longPressTimer = null;
let longPressCell = null;

function getWeekDays() {
  const { date: weekStart } = getWeekBounds(weekOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

document.addEventListener('pointerdown', e => {
  const cell = e.target.closest('.empty-cell[data-slot][data-day]');
  if (!cell) return;
  longPressCell = cell;
  longPressTimer = setTimeout(() => {
    if (longPressCell === cell) {
      const slot = parseInt(cell.dataset.slot);
      const dayIdx = parseInt(cell.dataset.day);
      openAddModal(slot, dayIdx);
    }
    longPressTimer = null;
  }, 500);
});

document.addEventListener('pointerup', () => {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressCell = null;
});

document.addEventListener('pointermove', e => {
  if (!longPressCell) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY);
  if (!cell || !cell.closest('.empty-cell') || cell.closest('.empty-cell') !== longPressCell) {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressCell = null;
  }
});

const addModal = document.getElementById('add-modal');
const addStartTime = document.getElementById('add-start-time');
const addEndTime = document.getElementById('add-end-time');
let addModalDay = null;

function openAddModal(slot, dayIdx) {
  const days = getWeekDays();
  addModalDay = days[dayIdx];
  addStartTime.value = SLOTS[slot][0];
  addEndTime.value = SLOTS[slot][1];
  document.getElementById('add-title').value = '';
  document.getElementById('add-location').value = '';
  addModal.querySelector('.add-date-display').textContent =
    addModalDay.toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  addModal.classList.add('visible');
  setTimeout(() => document.getElementById('add-title').focus(), 100);
}

addModal.querySelector('.add-cancel').addEventListener('click', () => {
  addModal.classList.remove('visible');
});

addModal.querySelector('.add-save').addEventListener('click', async () => {
  const title = document.getElementById('add-title').value.trim();
  if (!title) return;
  const location = document.getElementById('add-location').value.trim();
  const timeRe = /^(\d{1,2}):(\d{2})$/;
  const startVal = addStartTime.value.trim();
  const endVal = addEndTime.value.trim();
  if (!timeRe.test(startVal) || !timeRe.test(endVal)) return;
  if (endVal <= startVal) return;

  const [sh, sm] = startVal.split(':').map(Number);
  const [eh, em] = endVal.split(':').map(Number);

  const start = new Date(addModalDay);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(addModalDay);
  end.setHours(eh, em, 0, 0);

  const pad = n => String(n).padStart(2, '0');
  const tzOff = -start.getTimezoneOffset();
  const tzSign = tzOff >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOff) / 60));
  const tzM = pad(Math.abs(tzOff) % 60);
  const tz = `${tzSign}${tzH}:${tzM}`;
  const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${tz}`;

  await fetch('/custom-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, location, start: toLocal(start), end: toLocal(end) }),
  });

  addModal.classList.remove('visible');
  await loadAllEvents();
  renderWeeks();
});

addModal.addEventListener('click', e => {
  if (e.target === addModal) addModal.classList.remove('visible');
});
