// Time helpers. All times are plain {date: "YYYY-MM-DD", minutes} values in America/New_York;
// Date objects are only used for calendar arithmetic in UTC, so the device timezone never matters.
export const TZ = 'America/New_York';
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const pad = (n) => String(n).padStart(2, '0');
const utc = (date) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** New York wall time for an instant (default: now). Uses the explicit timeZone, never the device's. */
export function nowNY(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instant);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** Parse ?now=YYYY-MM-DDTHH:MM (New York wall time). Returns null if malformed. */
export function parseNowOverride(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
  // Date.UTC rolls 2026-13-45 over to a real day, so require the date to survive a round trip.
  if (!m || +m[2] > 23 || +m[3] > 59 || new Date(utc(m[1])).toISOString().slice(0, 10) !== m[1]) return null;
  return { date: m[1], minutes: +m[2] * 60 + +m[3] };
}

export const addDays = (date, n) => new Date(utc(date) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const dayKey = (date) => KEYS[new Date(utc(date)).getUTCDay()];
export const dayName = (date) => NAMES[new Date(utc(date)).getUTCDay()];
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':'); return +h * 60 + +m; };

/** Minutes (may exceed 1440) -> {t: "7:41", ap: "AM"}. */
export function fmt12(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return { t: `${h % 12 || 12}:${pad(m % 60)}`, ap: h < 12 ? 'AM' : 'PM' };
}
export const fmtText = (min) => { const f = fmt12(min); return `${f.t} ${f.ap}`; };
