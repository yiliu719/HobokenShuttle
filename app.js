import { nowNY, parseNowOverride, addDays, daysBetween, dayKey, dayName, toMin, fmt12, fmtText, SHORT } from './js/time.js';
import {
  TIGHT_MAX_MIN, departuresFor, noticesFor, nextDeparture, lastShuttle, shuttleConnections, arrivalOptions,
  homeShuttle, scheduleGroups, heroFrame, WTC,
} from './js/logic.js';

const TRIP_PLANNER = 'https://www.panynj.gov/path/en/trip-planner.html';
const EVENING_FROM_MIN = 14 * 60; // from here on, To PATH shows the last-shuttle banner
const MODE_TTL_MS = 3 * 3600e3; // a manual To/Home pick expires so tomorrow morning starts fresh
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: fine */ } },
};
const params = new URLSearchParams(location.search);
const override = parseNowOverride(params.get('now'));
const clock = () => override || nowNY();
const state = { schedules: null, path: null, buildingId: null, mode: 'to', arrival: 'now', sched: { dir: null, group: null, est: false } };
const building = () => state.schedules.buildings.find((b) => b.id === state.buildingId);

// ---- small formatters ----
const timeHtml = (min, cls = '', est = false) => {
  const f = fmt12(min);
  return `<span class="t ${cls}${est ? ' est' : ''}">${est ? '<span class="approx">≈</span>' : ''}${f.t}<small>${f.ap}</small></span>`;
};
function readable(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0F1B2D' : '#fff';
}
const chip = (v) => !v ? '' : `<span class="chip"${v.color ? ` style="background:${esc(v.color)};color:${readable(v.color)};box-shadow:none"` : ''}>${esc(v.label)}</span>`;
const hm = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
const slackHtml = (s, est = false) => { // est: the shuttle time is an estimate, so the slack is too
  const n = est ? '≈ ' : '';
  return s === 0 ? '<span class="slack ok">Just makes it</span>'
    : s <= TIGHT_MAX_MIN ? `<span class="slack tight">Tight · ${n}${s} min</span>` : `<span class="slack ok">${n}${s} min to spare</span>`;
};
const estLine = (d) => !d.estimated ? '' :
  `<div class="hero-est">Estimated from the shuttle’s loop · ${d.vehicle ? esc(d.vehicle.label) + ' returning' : 'returning'} from ${esc(d.returningFrom)}</div>`;
function heroHtml({ label, dep, frame, pill, sub, extra = '' }) {
  let head;
  if (!frame.gap) head = `<div class="hero-row">${timeHtml(dep.min, 'hero-time', dep.estimated)}${pill}</div>`;
  else if (frame.gap === 'same-day') head = `<p class="hero-gap">${esc(frame.headline)} <b>${frame.time}</b></p>`;
  else head = `<p class="hero-gap">${esc(frame.headline)}</p><p class="hero-next">${frame.next} <b>${frame.when} ${frame.time}</b></p>`;
  return `<section class="hero${frame.gap ? ' hero--gap' : ''}"><div class="hero-label">${label}</div>${head}
    <div class="hero-details"><div class="hero-meta">${chip(dep.vehicle)}<span>from ${esc(dep.from)}</span></div>${estLine(dep)}<hr>${sub}${extra}</div></section>`;
}
const bannerHtml = (text, min, est) => `<div class="banner">${text} <b>${est ? '≈ ' : ''}${fmtText(min)}</b></div>`;
const dayLabel = (now, date) => { const off = daysBetween(now.date, date); return off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : dayName(date); };

function noticesHtml(b, now) {
  return noticesFor(b, now.date).map((n) => `<div class="card notice"><p>${esc(n.text)}</p></div>`).join('');
}
const APPROX_NOTE = '<p class="foot">≈ times are estimated from each shuttle’s loop, not posted.</p>';
const footHtml = (b) => `<p class="foot">Times are estimates; ride to PATH assumed ~${b.rideMinutes} min.</p>${APPROX_NOTE}`;
const scheduleLink = '<a class="link-row" href="#/schedule">See full schedule</a>';

// ---- Screen 1: To PATH ----
function trainCard(c, est) {
  if (c.noDirectAfter) {
    return `<div class="card train"><div class="train-dest">${esc(c.dest)}</div><p class="nodirect">No direct WTC trains after <b class="mono">${fmtText(toMin(c.noDirectAfter))}</b> — <a href="${TRIP_PLANNER}" target="_blank" rel="noopener">check PATH for options</a></p></div>`;
  }
  if (c.none) return `<div class="card train"><div class="train-dest">${esc(c.dest)}</div><p class="nodirect">No trains found in the schedule.</p></div>`;
  return `<div class="card train"><div class="train-dest">${esc(c.dest)}</div>${timeHtml(c.first.abs, 'train-time')}
    <div class="train-then">${c.then ? `then ${timeHtml(c.then.abs)}` : ''}</div>${slackHtml(c.slack, est)}</div>`;
}

function toScreen(now, b) {
  const out = [noticesHtml(b, now)];
  const next = nextDeparture(b, 'to_path', now);
  if (!next) return out.concat(`<div class="card">No upcoming shuttles to PATH in the schedule.</div>`, scheduleLink, footHtml(b)).join('');
  const { dep } = next;
  const away = dep.min - now.minutes;
  out.push(heroHtml({
    label: 'Next shuttle', dep, pill: `<span class="pill">${away <= 0 ? 'now' : 'in ' + hm(away)}</span>`,
    frame: heroFrame({ direction: 'to_path', dep, date: next.date, now, minutesAway: away, noServiceToday: !departuresFor(b, 'to_path', now.date).length }),
    sub: `<div class="hero-sub">Arrives Hoboken PATH ≈ <b${dep.estimated ? ' class="est"' : ''}>${fmtText(dep.min + b.rideMinutes)}</b></div>`,
  }));
  const lastTo = lastShuttle(b, 'to_path', now.date, true);
  if (now.minutes >= EVENING_FROM_MIN && lastTo) out.push(bannerHtml(lastTo.min < now.minutes ? 'Last shuttle to PATH left at' : 'Last shuttle to PATH', lastTo.min, lastTo.estimated));
  out.push(`<h2 class="section-title">Trains you can make</h2>`, shuttleConnections(state.path, b, next).map((c) => trainCard(c, dep.estimated)).join(''));
  const later = next.list.slice(next.index + 1, next.index + 4);
  if (later.length) {
    out.push('<h2 class="section-title">Later shuttles</h2><ul class="list">');
    for (const d of later) {
      const c = shuttleConnections(state.path, b, { date: next.date, dep: d })[0];
      out.push(`<li class="row${d.estimated ? ' est' : ''}"><div class="row-main">${timeHtml(d.min, '', d.estimated)}${chip(d.vehicle)}</div>
        <div class="row-side">${c.first ? `${esc(c.dest)} ${timeHtml(c.first.abs)}${slackHtml(c.slack, d.estimated)}` : ''}</div></li>`);
    }
    out.push('</ul>');
  }
  out.push(scheduleLink, footHtml(b));
  return out.join('');
}

// ---- Screen 2: Home from PATH ----
function chosenArrivalAbs(now) {
  const a = state.arrival;
  return a === 'now' ? null : daysBetween(now.date, a.date) * 1440 + a.min;
}

function homeScreen(now, b) {
  const out = [noticesHtml(b, now)];
  const hs = homeShuttle(b, now, chosenArrivalAbs(now));
  if (!hs) return out.concat(`<div class="card">No upcoming shuttles from PATH in the schedule.</div>`, scheduleLink, footHtml(b)).join('');
  const { dep } = hs, off = daysBetween(now.date, hs.date);
  const miss = hs.miss ? `<div class="hero-miss">Miss it? Next one <b>${hs.miss.dep.estimated ? '≈ ' : ''}${fmtText(hs.miss.dep.min)}</b>${hs.miss.dep.vehicle ? ' · ' + esc(hs.miss.dep.vehicle.label) : ''}${daysBetween(hs.date, hs.miss.date) ? ' · ' + dayLabel(now, hs.miss.date) : ''}</div>` : '';
  out.push(heroHtml({
    label: 'Your shuttle home', dep, pill: `<span class="pill">${hs.waitMin <= 0 ? 'Leaving now' : hm(hs.waitMin) + ' wait'}</span>`,
    frame: heroFrame({ direction: 'from_path', dep, date: hs.date, now, minutesAway: hs.waitMin, noServiceToday: !departuresFor(b, 'from_path', now.date).length }),
    sub: `<div class="hero-sub">Home by ≈ <b${dep.estimated ? ' class="est"' : ''}>${fmtText(dep.min + b.rideMinutes)}</b></div>`, extra: miss,
  }));
  const last = lastShuttle(b, 'from_path', now.date);
  if (last) out.push(bannerHtml(last.min < now.minutes ? 'Last shuttle tonight left at' : 'Tonight’s last shuttle from PATH:', last.min, false)); // posted only
  const rest = hs.list.slice(hs.index + 1, hs.index + 6);
  if (rest.length) {
    out.push(`<h2 class="section-title">${off ? dayLabel(now, hs.date) + '’s shuttles' : dep.min >= EVENING_FROM_MIN ? 'Rest of tonight' : 'Later today'}</h2><ul class="list">`);
    out.push(rest.map((d) => `<li class="row${d.estimated ? ' est' : ''}"><div class="row-main">${timeHtml(d.min, '', d.estimated)}${chip(d.vehicle)}</div></li>`).join(''), '</ul>');
  }
  out.push(scheduleLink, footHtml(b));
  return out.join('');
}

const arrivalKey = (date, min) => `${date}|${min}`;
const originLabel = (origins) => origins.length > 1 ? origins.map((o) => (o === WTC ? 'WTC' : o)).join(' or ') : origins[0];

function refreshPicker(now) {
  const sel = $('#arrival');
  if (state.mode !== 'home' || document.activeElement === sel) return;
  const opts = arrivalOptions(state.path, now).map((o) => ({ date: o.date, min: o.min, from: originLabel(o.origins) }));
  const a = state.arrival;
  if (a !== 'now' && !opts.some((o) => arrivalKey(o.date, o.min) === arrivalKey(a.date, a.min))) opts.unshift(a); // keep a picked train that just passed
  const abs = (o) => daysBetween(now.date, o.date) * 1440 + o.min;
  sel.innerHTML = `<option value="now">I’m at the station now</option>` + opts.map((o) =>
    `<option value="${arrivalKey(o.date, o.min)}" data-from="${esc(o.from)}">${fmtText(abs(o))} · from ${esc(o.from)}</option>`).join('');
  sel.value = a === 'now' ? 'now' : arrivalKey(a.date, a.min);
}

// ---- Screen 3: full schedule ----
function scheduleScreen(now, b) {
  const groups = scheduleGroups(b);
  const s = state.sched;
  const today = dayKey(now.date);
  if (s.group == null || s.group >= groups.length) s.group = Math.max(0, groups.findIndex((g) => g.keys.includes(today)));
  const g = groups[s.group];
  const dir = s.dir || (state.mode === 'home' ? 'from_path' : 'to_path');
  const dirBtn = (v, label) => `<button type="button" class="seg-btn" data-dir="${v}" aria-pressed="${dir === v}">${label}</button>`;
  const out = [`<div class="seg seg--sched" role="group" aria-label="Direction">${dirBtn('to_path', 'To PATH')}${dirBtn('from_path', 'From PATH')}</div>`];
  out.push(`<div class="tabs" role="tablist" aria-label="Days">${groups.map((x, i) =>
    `<button type="button" role="tab" class="tab" data-group="${i}" aria-selected="${i === s.group}">${esc(x.label)}</button>`).join('')}</div>`);
  if (!g) return out.concat('<p class="note">No schedule for this building yet.</p>').join('');
  out.push(g.notices.map((n) => `<div class="card notice"><p>${esc(n.text)}</p></div>`).join(''));
  out.push(`<label class="toggle"><input type="checkbox" data-est${s.est ? ' checked' : ''}><span>Include estimated trips</span></label>`);
  const all = dir === 'to_path' ? g.to : g.from, list = all.filter((d) => s.est || !d.estimated);
  if (!list.length) out.push(`<p class="note">No ${all.length ? 'posted ' : ''}shuttle ${dir === 'to_path' ? 'to' : 'from'} PATH on these days.${all.length ? ' Turn on “Include estimated trips” to see estimated ones.' : ''}</p>`);
  else {
    const nextIdx = g.keys.includes(today) ? list.findIndex((d) => d.min >= now.minutes) : -1;
    out.push('<ul class="list">' + list.map((d, i) => {
      const cls = g.keys.includes(today) ? (nextIdx === -1 || i < nextIdx ? 'past' : i === nextIdx ? 'next' : '') : '';
      return `<li class="row ${cls}${d.estimated ? ' est' : ''}"><div class="row-main">${timeHtml(d.min, '', d.estimated)}${chip(d.vehicle)}</div>${cls === 'next' ? `<span class="badge">NEXT · ${d.min - now.minutes <= 0 ? 'now' : hm(d.min - now.minutes)}</span>` : ''}</li>`;
    }).join('') + '</ul>');
  }
  out.push(`<p class="foot">${esc(state.schedules.disclaimer || '')}</p>${APPROX_NOTE}`);
  return out.join('');
}

// ---- wiring ----
function render() {
  const now = clock(), b = building();
  $('#clock').innerHTML = `${SHORT[dayKey(now.date)]} · ${fmtText(now.minutes)}${override ? '<b>TEST</b>' : ''}`;
  const onSchedule = location.hash === '#/schedule';
  $('#screen-main').hidden = onSchedule;
  $('#screen-schedule').hidden = !onSchedule;
  if (onSchedule) { $('#schedule').innerHTML = scheduleScreen(now, b); return; }
  document.querySelectorAll('[data-mode]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.mode === state.mode)));
  $('#picker').hidden = state.mode !== 'home';
  refreshPicker(now);
  $('#content').innerHTML = state.mode === 'to' ? toScreen(now, b) : homeScreen(now, b);
}

function fillBuildings() {
  const html = state.schedules.buildings.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  for (const id of ['#building', '#building2']) { $(id).innerHTML = html; $(id).value = state.buildingId; }
}

function setBuilding(id) {
  state.buildingId = id;
  state.arrival = 'now';
  state.sched.group = null;
  store.set('hs.building', id);
  for (const sel of ['#building', '#building2']) $(sel).value = id;
  render();
}

function initMode(now) {
  const forced = params.get('mode');
  if (forced === 'to' || forced === 'home') return forced;
  try {
    const { mode, ts } = JSON.parse(override ? 'null' : store.get('hs.mode') || 'null') || {};
    if ((mode === 'to' || mode === 'home') && Date.now() - ts < MODE_TTL_MS) return mode;
  } catch { /* ignore bad stored value */ }
  return now.minutes < 14 * 60 ? 'to' : 'home';
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-mode],[data-dir],[data-group],#back');
  if (!el) return;
  if (el.dataset.mode) {
    state.mode = el.dataset.mode;
    state.arrival = 'now';
    if (!override) store.set('hs.mode', JSON.stringify({ mode: state.mode, ts: Date.now() }));
  } else if (el.dataset.dir) state.sched.dir = el.dataset.dir;
  else if (el.dataset.group) state.sched.group = Number(el.dataset.group);
  else if (el.id === 'back') { if (history.length > 1 && state.navigated) history.back(); else location.hash = ''; return; }
  render();
});
document.addEventListener('change', (e) => { if (e.target.matches('[data-est]')) { state.sched.est = e.target.checked; render(); } });
$('#arrival').addEventListener('change', (e) => {
  const [date, min] = e.target.value.split('|');
  state.arrival = e.target.value === 'now' ? 'now' : { date, min: Number(min), from: e.target.selectedOptions[0].dataset.from };
  render();
});
for (const id of ['#building', '#building2']) $(id).addEventListener('change', (e) => setBuilding(e.target.value));
window.addEventListener('hashchange', () => { state.navigated = true; render(); window.scrollTo(0, 0); });

async function main() {
  try {
    const [schedules, path] = await Promise.all(['data/schedules.json', 'data/path.json'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); })));
    if (schedules.version !== 3) throw new Error(`schedules.json version ${schedules.version}, expected 3`);
    Object.assign(state, { schedules, path });
  } catch (err) {
    $('#content').innerHTML = `<div class="card"><b>Couldn’t load the schedule.</b><p class="note">${esc(err.message)}</p></div>`;
    return;
  }
  const saved = store.get('hs.building');
  state.buildingId = knownBuilding(saved) ? saved : state.schedules.buildings[0].id;
  state.mode = initMode(clock());
  fillBuildings();
  render();
  if (!override) { setInterval(render, 30000); document.addEventListener('visibilitychange', () => !document.hidden && render()); }
}
const knownBuilding = (id) => state.schedules.buildings.some((b) => b.id === id);
main();
