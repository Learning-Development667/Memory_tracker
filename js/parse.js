// Reads one sentence, typed or spoken, into a job: what, when, whose list, how long.
// Pure functions. UK English: dates are day then month.

import { MIN, HOUR, DAY, startOfDay, endOfDay } from './order.js';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function num(s) { return NUM_WORDS[s] !== undefined ? NUM_WORDS[s] : parseInt(s, 10); }
function atTime(dayMs, h, m) { const d = new Date(dayMs); d.setHours(h, m || 0, 0, 0); return d.getTime(); }

// The stops on the "When" slider.
export function whenStops(now) {
  const today = startOfDay(now), d = new Date(now), h = d.getHours() + d.getMinutes() / 60, dow = d.getDay();
  const later = h < 16 ? 18 : h < 20.5 ? 21 : 23.5;
  const toSat = dow === 6 || dow === 0 ? (dow === 6 ? 1 : 0) : 6 - dow;
  const toMon = ((8 - dow) % 7) || 7;
  return [
    { label: 'No date', due: null, hasTime: false },
    { label: 'Within the hour', due: now + HOUR, hasTime: true },
    { label: 'Later today', due: atTime(today, Math.floor(later), later % 1 ? 30 : 0), hasTime: true },
    { label: 'Tomorrow', due: endOfDay(today + DAY + HOUR * 2), hasTime: false },
    { label: 'This weekend', due: endOfDay(atTime(today, 12) + toSat * DAY), hasTime: false },
    { label: 'Next week', due: endOfDay(atTime(today, 12) + toMon * DAY), hasTime: false },
  ];
}

// A first guess at how long a job takes, from its words. Longest matches first.
const SIZE_WORDS = [
  [480, /\b(decorat\w*|renovat\w*|re-?wir\w*|plaster\w*|landscap\w*|til(e|ing) the|clear (out )?the (garage|loft|shed|attic)|lay(ing)? (the )?(floor|patio|carpet))\b/],
  [240, /\b(build\w*|assembl\w*|paint\w*|fix\w*|repair\w*|install\w*|fit(ting)? the|deep clean\w*|declutter\w*|wallpaper\w*|sand(ing)? |varnish\w*|put up|flat ?pack)\b/],
  [60, /\b(sort\w*|organis\w*|clear out|clean the (oven|car|windows|fridge)|wash the car|batch cook\w*|big shop)\b/],
  [30, /\b(clean\w*|mow\w*|iron\w*|cook\w*|shop\w*|change the bed\w*|strip the bed\w*|hoover\w*|vacuum\w*|mop\w*|weed\w*|walk the dog)\b/],
  [15, /\b(tidy\w*|wipe\w*|empty\w*|load\w*|unload\w*|sweep\w*|fold\w*|make the bed\w*|wash up|washing up|hang (out|up)|dust\w*|pick up|collect\w*|drop off)\b/],
  [5, /\b(ring|call|phone|text|email|message|reply|pay|book|order|bins?|post|take out|put out|water|feed|put away|check|cancel|renew|remind|ask|tell|charge|lock|find|take (my|the|your) (tablets?|pills?|meds|medicine))\b/],
];
// Making or fitting something sizeable is a big job, whatever the verb.
const MAKING = /\b(build\w*|mak(e|es|ing)|fit(s|ting)?|install\w*|assembl\w*|construct\w*|put( [a-z ]{1,30})? together|put up|lay(ing)?|knock up|replace\w*|renew(ing)? the|redo\w*|re-?do\w*)\b/;
const SIZEABLE = /\b(cupboards?|wardrobes?|units?|shelving|bookcases?|dressers?|sideboards?|bunk ?beds?|desks?|bed ?frames?|headboards?|kitchen|bathroom|shower|bath|sheds?|fences?|fencing|decking|deck|patio|pergola|greenhouse|summer ?house|raised beds?|extension|conservatory|porch|garage|loft|floor(ing)?|doors|windows|staircase|stairs|worktops?)\b/;
export function guessSize(title) {
  const s = ' ' + String(title || '').toLowerCase() + ' ';
  if (MAKING.test(s) && SIZEABLE.test(s)) return 480;
  for (const [min, re] of SIZE_WORDS) if (re.test(s)) return min;
  return 15;
}

// ctx: { now, me, other, otherName }
export function parseSentence(text, ctx) {
  const now = ctx.now;
  const today = startOfDay(now);
  let s = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ';
  const out = { title: '', due: null, hasTime: false, list: null, size: null, remind: null };
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  // Whose list.
  take(/\b(?:for|on) (?:either of us|both of us|either|both|us|whoever)\b/i, () => { out.list = 'either'; });
  if (!out.list) take(/\bfor (?:me|myself)\b/i, () => { out.list = ctx.me; });
  if (!out.list && ctx.otherName) {
    const n = esc(ctx.otherName.trim());
    if (n) take(new RegExp("\\b(?:for " + n + "|on " + n + "(?:'s|’s|s)? list)\\b", 'i'), () => { out.list = ctx.other; });
  }

  // Reminder level.
  take(/\b(?:and )?(?:buzz me|with (?:a |the )?buzzer|buzzer on)\b/i, () => { out.remind = 'buzzer'; });
  if (!out.remind) take(/\b(?:and )?(?:nudge me|keep reminding me)\b/i, () => { out.remind = 'nudge'; });

  // Size, only when said plainly: "takes 20 minutes", "a 5 minute job".
  take(/\b(?:it )?takes (?:about |around )?(\d+|an?|half an|one|two|three|four) ?(min|mins|minute|minutes|hour|hours|hr|hrs)\b/i, (m) => {
    const unit = /^h/i.test(m[2]) ? 60 : 1;
    out.size = m[1].toLowerCase() === 'half an' ? 30 : num(m[1].toLowerCase()) * unit;
  });
  if (out.size === null) take(/\b(?:an? )?(\d+)[ -]?(?:min|mins|minute) job\b/i, (m) => { out.size = parseInt(m[1], 10); });
  // Days and weeks: "probably take me 2 days", "a two day job", "a week's work". A working day is 8 hours.
  const DAYS_OF = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, 'a couple of': 2, 'a few': 3 };
  const dayCount = (w) => (DAYS_OF[w.toLowerCase()] !== undefined ? DAYS_OF[w.toLowerCase()] : parseInt(w, 10));
  if (out.size === null) take(/[,.]?\s*\b(?:it(?:'ll| will)? |(?:i|we)(?:'ll| will) )?(?:probably |should |might |about |around )*takes? (?:me |us |him |her )?(?:about |around )?(\d+|an?|one|two|three|four|five|a couple of|a few) (days?|weeks?)\b(?: to (?:get it )?(?:finish|finished|do|done|complete)\w*)?/i, (m) => {
    out.size = dayCount(m[1]) * (/^w/i.test(m[2]) ? 2400 : 480);
  });
  if (out.size === null) take(/\b(?:an? )?(\d+|one|two|three|four|five)[ -]days?(?: long)? job\b/i, (m) => { out.size = dayCount(m[1]) * 480; });

  let day = null;        // start of the day named
  let time = null;       // { h, m, fixed } from a clock time
  let partOfDay = null;  // hour implied by "morning", "tonight"
  let exact = null;      // from "in 20 minutes"

  // In so long.
  take(/\b(?:with)?in (?:the )?next hour\b|\bwithin the hour\b|\bin the next hour\b/i, () => { exact = now + HOUR; });
  if (exact === null) take(/\b(?:with)?in half an hour\b/i, () => { exact = now + 30 * MIN; });
  if (exact === null) take(/\b(?:with)?in (\d+|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty) ?(min|mins|minute|minutes|hour|hours|hr|hrs)\b/i, (m) => {
    exact = now + num(m[1].toLowerCase()) * (/^h/i.test(m[2]) ? HOUR : MIN);
  });
  if (exact === null) take(/\bin (\d+|an?|one|two|three|four|five|six) (day|days|week|weeks)\b/i, (m) => {
    day = today + num(m[1].toLowerCase()) * (/^w/i.test(m[2]) ? 7 : 1) * DAY + 2 * HOUR;
    day = startOfDay(day);
  });

  // Named days.
  if (exact === null && day === null) {
    take(/\b(?:by |on |for |before )?(tomorrow|today|tonight)(?: (morning|afternoon|evening|night))?\b/i, (m) => {
      const w = m[1].toLowerCase(), p = (m[2] || '').toLowerCase();
      day = w === 'tomorrow' ? startOfDay(today + DAY + 2 * HOUR) : today;
      if (w === 'tonight' || p === 'night') partOfDay = 20;
      else if (p === 'morning') partOfDay = 9;
      else if (p === 'afternoon') partOfDay = 15;
      else if (p === 'evening') partOfDay = 19;
    }) ||
    take(/\b(?:by |before )?this (morning|afternoon|evening)\b/i, (m) => {
      day = today;
      partOfDay = { morning: 9, afternoon: 15, evening: 19 }[m[1].toLowerCase()];
    }) ||
    take(/\b(?:by |on |for |before )?(?:this |at the |the )weekend\b/i, () => {
      const dow = new Date(now).getDay();
      day = startOfDay(today + (dow === 6 ? 1 : dow === 0 ? 0 : 6 - dow) * DAY + 2 * HOUR);
    }) ||
    take(/\b(?:by |for |before )?next week\b/i, () => {
      const dow = new Date(now).getDay();
      day = startOfDay(today + (((8 - dow) % 7) || 7) * DAY + 2 * HOUR);
    }) ||
    take(new RegExp('\\b(?:by |on |for |before )?(next |this )?(' + DAY_NAMES.join('|') + ')(?: (morning|afternoon|evening|night))?\\b', 'i'), (m) => {
      const dow = new Date(now).getDay(), want = DAY_NAMES.indexOf(m[2].toLowerCase());
      let add = (want - dow + 7) % 7;
      if (add === 0) add = 7;
      if ((m[1] || '').toLowerCase() === 'next ' && add < 7 && want > dow) add += 7;
      day = startOfDay(today + add * DAY + 2 * HOUR);
      const p = (m[3] || '').toLowerCase();
      if (p) partOfDay = { morning: 9, afternoon: 15, evening: 19, night: 20 }[p];
    }) ||
    take(new RegExp('\\b(?:by |on |for |before )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(' + MONTH_NAMES.join('|') + ')[a-z]*\\b', 'i'), (m) => {
      const dd = parseInt(m[1], 10), mm = MONTH_NAMES.indexOf(m[2].toLowerCase().slice(0, 3));
      if (dd < 1 || dd > 31) return false;
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setMonth(mm, dd);
      if (d.getTime() < today) d.setFullYear(d.getFullYear() + 1);
      day = d.getTime();
    }) ||
    take(/\b(?:by |on |for |before )?(\d{1,2})\/(\d{1,2})\b/, (m) => {
      const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10) - 1;
      if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return false;
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setMonth(mm, dd);
      if (d.getTime() < today) d.setFullYear(d.getFullYear() + 1);
      day = d.getTime();
    });
  }

  // Clock times. A bare number only counts with "by", "at" or "before" in front of it.
  if (exact === null) {
    take(/\b(?:by |at |before )?(noon|midday|midnight)\b/i, (m) => {
      time = /midnight/i.test(m[1]) ? { h: 23, m: 59, fixed: true } : { h: 12, m: 0, fixed: true };
    }) ||
    take(/\b(?:by |at |before |around )?(\d{1,2})[:.](\d{2}) ?(am|pm|a\.m\.|p\.m\.)?(?=[\s,.]|$)/i, (m) => {
      let h = parseInt(m[1], 10); const mi = parseInt(m[2], 10);
      if (h > 23 || mi > 59) return false;
      const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      time = { h, m: mi, fixed: !!ap || h > 12 || h === 0 };
    }) ||
    take(/\b(?:by |at |before |around )?(\d{1,2}) ?(am|pm|a\.m\.|p\.m\.)(?=[\s,.]|$)/i, (m) => {
      let h = parseInt(m[1], 10);
      if (h < 1 || h > 12) return false;
      const ap = m[2].toLowerCase().replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      time = { h, m: 0, fixed: true };
    }) ||
    take(/\b(?:by|at|before) (\d{1,2})(?: o'?clock)?(?=[\s,.]|$)/i, (m) => {
      const h = parseInt(m[1], 10);
      if (h < 1 || h > 23) return false;
      time = { h, m: 0, fixed: h > 12 };
    });
  }

  // Put day and time together.
  if (exact !== null) { out.due = exact; out.hasTime = true; }
  else if (time) {
    const base = day === null ? today : day;
    let due = atTime(base, time.h, time.m);
    if (!time.fixed && time.h <= 12) {
      const am = atTime(base, time.h % 12, time.m), pm = atTime(base, (time.h % 12) + 12, time.m);
      if (partOfDay !== null) due = partOfDay >= 12 ? pm : am;
      else if (base === today) due = am > now ? am : pm;
      else due = time.h < 8 ? pm : am;
    }
    if (day === null && due <= now) due += DAY;
    out.due = due; out.hasTime = true;
  } else if (day !== null) {
    if (partOfDay !== null) { out.due = atTime(day, partOfDay, 0); out.hasTime = true; }
    else { out.due = endOfDay(day); out.hasTime = false; }
  }

  // What is left is the job.
  let t = s.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+([,.;:])/g, '$1').replace(/[,;:]+(?=[,;:.]|$)/g, '');
  t = t.replace(/^(?:please |can you |could you |remind me to |remember to |i need to |we need to |need to )+/i, '');
  t = t.replace(/(?:[\s,]+and)+$/i, '').replace(/[\s,.;:]+$/g, '').trim();
  out.title = t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  return out;
}
