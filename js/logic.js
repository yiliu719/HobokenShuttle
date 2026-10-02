// Pure schedule logic: no DOM, no globals. See README for the data rules this implements.
import { addDays, daysBetween, dayKey, dayName, toMin, fmtText, DAY_KEYS, SHORT } from './time.js';

export const PLATFORM_BUFFER_MIN = 2; // shuttle arrival -> catching a PATH train
export const HOME_WALK_MIN = 3;       // PATH platform -> shuttle stop (only when a train is picked)
export const TIGHT_MAX_MIN = 3;       // slack at or below this is "tight"
export const ARRIVAL_WINDOW_MIN = 90; // how far ahead the "my train arrives" picker looks
export const GAP_THRESHOLD_MIN = 60;  // next departure further away than this: the hero leads with the gap
export const DESTINATIONS = ['33rd St', 'World Trade Center'];
export const WTC = 'World Trade Center';

/** Resolve a vehicle id ONLY through its own building. null id -> null (no chip). */
export function vehicleOf(building, id) {
  if (id == null) return null;
  const v = building.vehicles[id];
  return v ? { id, label: v.label, color: v.color || null } : null;
}

export const PATH_NAME = 'Hoboken PATH Station';
const OPPOSITE = { to_path: 'from_path', from_path: 'to_path' };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Where trips in `direction` start: the building's own posted stop name for that direction, else a sensible default. */
function endName(building, direction) {
  const svc = building.services.find((s) => s.direction === direction);
  return svc ? svc.from : direction === 'to_path' ? building.name : PATH_NAME;
}

/** Posted departures for a weekday key in one direction: services whose `days` include it, merged and sorted. */
function postedForKey(building, direction, key) {
  const seen = new Set(), out = [];
  for (const s of building.services) {
    if (s.direction !== direction || !s.days.includes(key)) continue;
    for (const d of s.departures) {
      const id = `${d.time}|${d.vehicle}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ time: d.time, min: toMin(d.time), vehicle: vehicleOf(building, d.vehicle), from: s.from, estimated: false });
    }
  }
  return out.sort((a, b) => a.min - b.min);
}

/**
 * Posted + estimated departures for a weekday key. Shuttles run continuous loops but each sheet posts one end,
 * so every posted departure implies an unposted one in the opposite direction `loopMinutes` later, same vehicle.
 * The last posted from_path departure of the date has no return to PATH. A posted departure at the same time
 * and direction wins over an estimate. Every entry carries `estimated: true|false`.
 */
export function departuresForKey(building, direction, key) {
  const posted = postedForKey(building, direction, key);
  const reverse = OPPOSITE[direction];
  const sources = postedForKey(building, reverse, key);
  const lastEvening = reverse === 'from_path' && sources.length ? sources[sources.length - 1].min : null;
  const taken = new Set(posted.map((d) => d.min));
  const estimates = [];
  for (const s of sources) {
    const min = s.min + building.loopMinutes;
    if (s.min === lastEvening || min >= 1440 || taken.has(min)) continue;
    estimates.push({
      time: hhmm(min), min, vehicle: s.vehicle, estimated: true,
      from: endName(building, direction),
      returningFrom: direction === 'to_path' ? 'PATH' : building.name, // where the posted run it derives from started
    });
  }
  return posted.concat(estimates).sort((a, b) => a.min - b.min);
}
export const departuresFor = (b, dir, date) => departuresForKey(b, dir, dayKey(date));
export const noticesForKey = (b, key) => (b.notices || []).filter((n) => n.days.includes(key));
export const noticesFor = (b, date) => noticesForKey(b, dayKey(date));

/** Last departure of the date; posted only unless includeEstimated. */
export function lastShuttle(building, direction, date, includeEstimated = false) {
  const list = departuresFor(building, direction, date).filter((d) => includeEstimated || !d.estimated);
  return list.length ? list[list.length - 1] : null;
}

/** First departure at or after `from` ({date, minutes}), scanning up to a week ahead. */
export function nextDeparture(building, direction, from) {
  for (let off = 0; off <= 7; off++) {
    const date = addDays(from.date, off);
    const list = departuresFor(building, direction, date);
    const index = list.findIndex((d) => off > 0 || d.min >= from.minutes);
    if (index >= 0) return { dep: list[index], date, list, index };
  }
  return null;
}

// ---- PATH ----
export function pathDayType(path, date) {
  if ((path.holidays || []).includes(date)) return 'sunday';
  const k = dayKey(date);
  return k === 'sat' ? 'saturday' : k === 'sun' ? 'sunday' : 'weekday';
}

/** Today's table plus tomorrow's shifted by 1440, so lookups near midnight cross the day boundary. */
export function pathTimeline(path, date, kind) {
  const out = [];
  for (const off of [0, 1]) {
    const table = path.serviceDays[pathDayType(path, addDays(date, off))][kind];
    for (const e of table) out.push({ ...e, abs: off * 1440 + toMin(e.time) });
  }
  return out.sort((a, b) => a.abs - b.abs);
}

/** For a shuttle arriving at the station at `arriveMin` (minutes from `date` 00:00): next two trains per destination. */
export function connections(path, date, arriveMin) {
  const timeline = pathTimeline(path, date, 'departures');
  const lastWTC = (path.lastDirectWTC || {})[pathDayType(path, date)];
  const earliest = arriveMin + PLATFORM_BUFFER_MIN;
  return DESTINATIONS.map((dest) => {
    if (dest === WTC && lastWTC && earliest > toMin(lastWTC)) return { dest, noDirectAfter: lastWTC };
    const trains = timeline.filter((e) => e.to === dest && e.abs >= earliest);
    if (!trains.length) return { dest, none: true };
    return { dest, first: trains[0], then: trains[1] || null, slack: trains[0].abs - earliest };
  });
}
export const shuttleConnections = (path, building, next) =>
  connections(path, next.date, next.dep.min + building.rideMinutes);

/** PATH arrivals at Hoboken from now until now + window (minutes from now.date 00:00). */
export function pathArrivalsWindow(path, now, windowMin = ARRIVAL_WINDOW_MIN) {
  return pathTimeline(path, now.date, 'arrivals').filter((e) => e.abs >= now.minutes && e.abs <= now.minutes + windowMin);
}

/** Picker options: arrivals in the same minute merged into one, with their origins (33rd St before WTC). */
export function arrivalOptions(path, now, windowMin = ARRIVAL_WINDOW_MIN) {
  const byAbs = new Map();
  for (const e of pathArrivalsWindow(path, now, windowMin)) {
    if (!byAbs.has(e.abs)) byAbs.set(e.abs, { abs: e.abs, date: addDays(now.date, Math.floor(e.abs / 1440)), min: e.abs % 1440, origins: [] });
    const o = byAbs.get(e.abs);
    if (!o.origins.includes(e.from)) o.origins.push(e.from);
  }
  for (const o of byAbs.values()) o.origins.sort((a, b) => DESTINATIONS.indexOf(a) - DESTINATIONS.indexOf(b));
  return [...byAbs.values()];
}

/**
 * How the hero frames the next departure. Null `gap` = normal hero (time + countdown pill). Otherwise the hero
 * leads with the gap: 'same-day' when the departure is more than GAP_THRESHOLD_MIN away, 'later-day' when it is
 * on a later date. `minutesAway` is the countdown (to_path) or the wait (from_path).
 */
export function heroFrame({ direction, dep, date, now, minutesAway, noServiceToday }) {
  const dayOffset = daysBetween(now.date, date);
  const gap = dayOffset > 0 ? 'later-day' : minutesAway > GAP_THRESHOLD_MIN ? 'same-day' : null;
  if (!gap) return { gap };
  const toPath = direction === 'to_path';
  const time = (dep.estimated ? '≈ ' : '') + fmtText(dep.min);
  if (gap === 'same-day') return { gap, headline: `No shuttle ${toPath ? 'to PATH' : 'home'} until`, time };
  const headline = noServiceToday ? `No shuttle ${toPath ? 'to' : 'from'} PATH on ${dayName(now.date)}`
    : toPath ? 'No more shuttles to PATH today' : 'No more shuttles from PATH tonight';
  return { gap, headline, next: 'Next:', when: dayOffset === 1 ? 'Tomorrow' : dayName(date), time };
}

/** Shuttle home. arrivalAbs = chosen train arrival (minutes from now.date 00:00) or null for "at the station now". */
export function homeShuttle(building, now, arrivalAbs) {
  const from = arrivalAbs == null ? now.minutes : arrivalAbs + HOME_WALK_MIN;
  const dayShift = Math.floor(from / 1440);
  const next = nextDeparture(building, 'from_path', { date: addDays(now.date, dayShift), minutes: from - dayShift * 1440 });
  if (!next) return null;
  const miss = nextDeparture(building, 'from_path', { date: next.date, minutes: next.dep.min + 1 });
  const depAbs = daysBetween(now.date, next.date) * 1440 + next.dep.min;
  return { ...next, miss, waitMin: depAbs - (arrivalAbs == null ? now.minutes : arrivalAbs) };
}

// ---- Full schedule: tabs are groups of days with identical schedules, derived from the data ----
function runLabel(keys) {
  const idx = keys.map((k) => DAY_KEYS.indexOf(k)), runs = [];
  idx.forEach((i, n) => (n && i === idx[n - 1] + 1 ? runs[runs.length - 1].push(i) : runs.push([i])));
  return runs.map((r) => (r.length > 1 ? `${SHORT[DAY_KEYS[r[0]]]}–${SHORT[DAY_KEYS[r[r.length - 1]]]}` : SHORT[DAY_KEYS[r[0]]])).join(', ');
}

export function scheduleGroups(building) {
  const groups = [], bySig = new Map();
  for (const key of DAY_KEYS) {
    const to = departuresForKey(building, 'to_path', key), from = departuresForKey(building, 'from_path', key);
    const notices = noticesForKey(building, key);
    if (!to.length && !from.length && !notices.length) continue; // no tab for days with nothing to say
    const sig = JSON.stringify([to, from, notices].map((l) => l.map((x) => x.text || `${x.time}|${x.vehicle && x.vehicle.id}|${x.estimated}`)));
    if (!bySig.has(sig)) { const g = { keys: [], to, from, notices }; bySig.set(sig, g); groups.push(g); }
    bySig.get(sig).keys.push(key);
  }
  groups.forEach((g) => { g.label = runLabel(g.keys); });
  return groups;
}
