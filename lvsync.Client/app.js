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

async function buildHTML(offset) {
  const { from, to, date: weekStart } = getWeekBounds(offset);
  try {
    const res = await fetch(`/events?from_ts=${from}&to_ts=${to}`);
    const events = await res.json();

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return { date: d, key: dayKey(d) };
    });

    const placed = [];
    const covered = new Set();

    for (const e of events) {
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
      html += `<div class="cell event-cell" style="grid-row:${startSlot + 2}/span ${span};grid-column:${dayIdx + 2}">
        <div class="event${isToday ? ' today' : ''}">
          <div class="event-abbr">${e.summary.slice(0, 3).toUpperCase()}${e.location && e.location.toLowerCase().includes('webinar') ? '<span class="webinar-icon material-symbols-outlined">videocam</span>' : ''}</div>
          <div class="event-time">${SLOTS[startSlot][0]}<br>${SLOTS[lastSlot][1]}</div>
        </div>
      </div>`;
    }

    for (let s = 0; s < SLOTS.length; s++) {
      for (let d = 0; d < 7; d++) {
        if (!covered.has(`${s},${d}`)) {
          html += `<div class="cell" style="grid-row:${s + 2};grid-column:${d + 2}"></div>`;
        }
      }
    }

    return html + '</div>';
  } catch (err) {
    return `<div class="error">${err.message}</div>`;
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

async function render() {
  document.getElementById('week-label').textContent = formatWeekLabel(getWeekBounds(weekOffset).date, weekOffset);
  const [prev, curr, next] = await Promise.all([
    buildHTML(weekOffset - 1),
    buildHTML(weekOffset),
    buildHTML(weekOffset + 1),
  ]);
  outPrev.innerHTML = prev;
  outCurr.innerHTML = curr;
  outNext.innerHTML = next;
  const h = panelH() + 'px';
  outPrev.style.height = h;
  outCurr.style.height = h;
  outNext.style.height = h;
  setTrack(-panelH(), false);
  updateTimeIndicator();
}

setInterval(updateTimeIndicator, 60_000);
render();

let touchStartY = null;
let baseY = 0;
let touchMode = null; // 'swipe' (week nav) or 'scroll' (panel scroll)

document.addEventListener('touchstart', e => {
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
    setTrack(baseY - dir * panelH(), true);
    setTimeout(() => { weekOffset += dir; render(); }, 285);
  } else if (touchMode === 'swipe') {
    setTrack(baseY, true);
  }
  touchMode = null;
}, { passive: true });
