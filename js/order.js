// How the list arranges itself. Pure functions: no DOM, no storage.

export const MIN = 60000, HOUR = 3600000, DAY = 86400000;

export const SIZES = [
  { min: 5, long: '5 minutes', short: '5 min' },
  { min: 15, long: '15 minutes', short: '15 min' },
  { min: 30, long: 'Half an hour', short: '30 min' },
  { min: 60, long: 'An hour', short: '1 hour' },
  { min: 120, long: 'A couple of hours', short: '2 hours' },
  { min: 240, long: 'Half a day', short: 'Half a day' },
  { min: 480, long: 'A big job', short: 'Big job' },
];

// How long before its date a job starts to climb, in minutes, by size.
const LEAD_MIN = { 5: 60, 15: 120, 30: 180, 60: 360, 120: 720, 240: 2880, 480: 7200 };

export const BANDS = ['Now', 'Next up', 'When you get a round tuit'];
export const STALE_DAYS = 14;

export function sizeIndex(min) {
  let best = 0;
  SIZES.forEach((s, i) => { if (Math.abs(s.min - min) < Math.abs(SIZES[best].min - min)) best = i; });
  return best;
}
export function sizeInfo(min) { return SIZES[sizeIndex(min)]; }

export function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function endOfDay(ms) { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); }

export function openSteps(t) { return (t.steps || []).filter((s) => !s.done); }

// A big job with a next step counts as a short one, so it does not sink for ever.
export function effectiveSize(t) { return openSteps(t).length ? Math.min(t.size, 30) : t.size; }

export function leadMs(t) { return (LEAD_MIN[sizeInfo(t.size).min] || 120) * MIN; }

export function band(t, now) {
  if (!t.due) return 2;
  if (t.due <= now + HOUR) return 0;
  if (t.due <= endOfDay(now) || now >= t.due - leadMs(t)) return 1;
  return 2;
}

export function compare(a, b, now) {
  const ba = band(a, now), bb = band(b, now);
  if (ba !== bb) return ba - bb;
  if (ba < 2) return (a.due - b.due) || (effectiveSize(a) - effectiveSize(b)) || (a.createdAt - b.createdAt);
  const sa = effectiveSize(a), sb = effectiveSize(b);
  if (sa !== sb) return sa - sb;
  const da = a.due || Infinity, db = b.due || Infinity;
  if (da !== db) return da - db;
  return a.createdAt - b.createdAt;
}

// Open jobs in order, each with its band.
export function arrange(tasks, now) {
  return tasks
    .filter((t) => !t.doneAt)
    .slice()
    .sort((a, b) => compare(a, b, now))
    .map((t) => ({ task: t, band: band(t, now) }));
}

export function isStale(t, now) {
  return !t.doneAt && !t.due && now - (t.keptAt || t.createdAt) >= STALE_DAYS * DAY;
}

// When a reminder first sounds: the time given, or 9 am on the day if no time was given.
export function alertAt(t) {
  if (!t.due) return null;
  return t.hasTime ? t.due : startOfDay(t.due) + 9 * HOUR;
}

export function nextRepeat(t) {
  if (!t.repeat || !t.due) return null;
  const d = new Date(t.due);
  if (t.repeat === 'day') d.setDate(d.getDate() + 1);
  else if (t.repeat === 'week') d.setDate(d.getDate() + 7);
  else if (t.repeat === 'fortnight') d.setDate(d.getDate() + 14);
  else if (t.repeat === 'month') d.setMonth(d.getMonth() + 1);
  else return null;
  return d.getTime();
}

function clock(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayWord(ms, now) {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAYS[new Date(ms).getDay()];
  const d = new Date(ms);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date(now).getFullYear() ? ' ' + d.getFullYear() : '');
}

// The words for a job's date, and how pressing it is: 'late', 'soon' or ''.
export function dueWords(t, now) {
  if (!t.due) return { text: '', state: '' };
  const when = dayWord(t.due, now) + (t.hasTime ? ' ' + clock(t.due) : '');
  if (t.due < now) return { text: 'Overdue: ' + when.charAt(0).toLowerCase() + when.slice(1), state: 'late' };
  if (t.due <= now + HOUR) return { text: 'Due ' + (t.hasTime ? clock(t.due) : 'today'), state: 'soon' };
  return { text: when, state: '' };
}

export function whenWords(due, hasTime, now) {
  if (!due) return 'No date';
  return dayWord(due, now) + (hasTime ? ', ' + clock(due) : '');
}
