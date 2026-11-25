// Round TUIT: the screens.

import { MIN, DAY, SIZES, BANDS, arrange, isStale, effectiveSize, openSteps, sizeIndex, sizeInfo, dueWords, whenWords, startOfDay, endOfDay, nextRepeat } from './order.js';
import { parseSentence, guessSize, whenStops } from './parse.js';
import * as store from './store.js';
import { speakButton, stopSpeech, canSpeak } from './speech.js';
import { LEVELS, SILENCE_FOR, startReminders, startSound, stopSound, unlockSound, askToNotify, notifyState } from './alarm.js';
import { watchTextSize } from './textsize.js';
import { enablePush, disablePush, pushOn, canPush } from './push.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const TICK = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const FIT_STOPS = [5, 10, 15, 30, 45, 60, 90, 120];
const REPEATS = [['', 'Does not repeat'], ['day', 'Every day'], ['week', 'Every week'], ['fortnight', 'Every fortnight'], ['month', 'Every month']];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A small element builder. Text is always set as text, never as HTML.
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'svg') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'open' || k === 'selected') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

const state = store.load();
const view = { list: store.me(), fit: 0 };
const sheet = $('#sheet'), buzzer = $('#buzzer'), toastBox = $('#toast');


// Sharing between phones is switched on by filling in config.js. Until then everything stays on this phone.
const CONFIG = window.ROUND_TUIT_CONFIG || {};
const canShare = !!(CONFIG.firebase && CONFIG.firebase.apiKey && CONFIG.bridge);
let sync = null, shareFailed = false;

/* ---------- small messages ---------- */
let toastTimer = null;
function toast(text, undo) {
  clearTimeout(toastTimer);
  toastBox.replaceChildren(el('span', { text }));
  if (undo) toastBox.append(el('button', { type: 'button', text: 'Undo', onclick: () => { undo(); hideToast(); } }));
  // A message must show above an open sheet, which sits in the browser's top layer.
  const host = buzzer.open ? buzzer : sheet.open ? sheet : document.body;
  if (toastBox.parentNode !== host) host.append(toastBox);
  toastBox.hidden = false;
  toastTimer = setTimeout(hideToast, undo ? 7000 : 4000);
}
function hideToast() { toastBox.hidden = true; if (toastBox.parentNode !== document.body) document.body.append(toastBox); }

function minutesWords(m) {
  if (m < 60) return m + ' minutes';
  const h = m / 60;
  return h === 1 ? 'an hour' : h === 1.5 ? 'an hour and a half' : h + ' hours';
}

/* ---------- doing things to jobs ---------- */
function completeTask(t) {
  const snap = store.snapshot();
  const steps = openSteps(t);
  if (steps.length > 1) {
    steps[0].done = true; t.updatedAt = Date.now();
    store.save();
    toast('Step done: ' + steps[0].title, () => store.restore(snap));
    return;
  }
  if (steps.length === 1) steps[0].done = true;
  const now = Date.now();
  t.doneAt = now; t.doneBy = store.me(); t.updatedAt = now;
  const again = nextRepeat(t);
  if (again) {
    state.tasks.push(store.newTask({
      title: t.title, list: t.list, addedBy: t.addedBy, due: again, hasTime: t.hasTime, size: t.size, sizeFrom: t.sizeFrom,
      label: t.label, remind: t.remind, repeat: t.repeat, steps: (t.steps || []).map((s) => ({ id: store.uid(), title: s.title, done: false })),
    }));
  }
  store.save();
  toast('Done: ' + t.title, () => store.restore(snap));
}
function putBack(t) { t.doneAt = null; t.doneBy = null; t.updatedAt = Date.now(); store.save(); }
function removeTask(t) {
  const snap = store.snapshot();
  state.tasks = state.tasks.filter((x) => x.id !== t.id);
  store.save();
  toast('Removed: ' + t.title, () => store.restore(snap));
}

/* ---------- the list ---------- */
function labelOf(t) { return state.labels.find((l) => l.id === t.label) || null; }

function jobRow(t, now, opts) {
  const o = opts || {};
  const label = labelOf(t), due = dueWords(t, now), steps = openSteps(t), total = (t.steps || []).length;
  const li = el('li', { class: 'job' + (t.doneAt ? ' done' : ''), 'data-colour': label ? label.colour : null, 'data-id': t.id });

  const meta = el('span', { class: 'meta' });
  const bits = [];
  if (!t.doneAt) bits.push(document.createTextNode(sizeInfo(effectiveSize(t)).short));
  if (due.text && !t.doneAt) bits.push(el('span', { class: due.state || null, text: due.text }));
  if (label) { const s = el('span', {}, el('i', { class: 'dot' }), label.name); bits.push(s); }
  if (t.due && !t.doneAt && t.remind !== 'quiet') bits.push(document.createTextNode(t.remind === 'buzzer' ? 'Buzzer' : 'Nudge'));
  if (t.repeat) bits.push(document.createTextNode(REPEATS.find((r) => r[0] === t.repeat)[1]));
  const byMe = t.addedBy === store.me();
  if (t.list === 'either' ? !byMe : t.addedBy !== t.list) bits.push(document.createTextNode('From ' + (byMe ? 'you' : store.nameOf(t.addedBy))));
  if (t.doneAt) bits.push(document.createTextNode('Done by ' + (t.doneBy === store.me() ? 'you' : store.nameOf(t.doneBy))));
  bits.forEach((b, i) => { if (i) meta.append(' · '); meta.append(b); });

  const tick = el('button', {
    type: 'button', class: 'tick',
    'aria-label': t.doneAt ? 'Put back: ' + t.title : steps.length > 1 ? 'Step done: ' + steps[0].title : 'Done: ' + t.title,
    onclick: () => {
      if (t.doneAt) { putBack(t); return; }
      li.classList.add('ticking');
      setTimeout(() => completeTask(t), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    },
  }, el('i', { svg: TICK }));

  const body = el('button', { type: 'button', class: 'jobbody', onclick: () => openJob(t) },
    el('span', { class: 'jt', text: t.title }),
    steps.length && !t.doneAt ? el('span', { class: 'next', text: 'Next: ' + steps[0].title + ' (' + (total - steps.length) + ' of ' + total + ' done)' }) : null,
    meta);

  li.append(tick, body);
  if (o.stale) {
    li.append(el('div', { class: 'rowacts' },
      el('button', { type: 'button', text: 'Keep', onclick: () => { t.keptAt = Date.now(); store.save(); toast('Kept: ' + t.title); } }),
      el('button', { type: 'button', text: 'Remove', onclick: () => removeTask(t) })));
  }
  return li;
}

function renderTabs() {
  const nav = $('#lists');
  nav.hidden = !state.profile.setup;
  nav.replaceChildren(...[store.me(), store.other(), 'either'].map((id) => {
    const n = state.tasks.filter((t) => t.list === id && !t.doneAt).length;
    return el('button', {
      type: 'button', 'aria-pressed': view.list === id ? 'true' : 'false',
      'aria-label': store.listTitle(id) + ', ' + n + (n === 1 ? ' job' : ' jobs'),
      onclick: () => { view.list = id; render(); window.scrollTo(0, 0); },
    }, store.listTitle(id), el('span', { class: 'n', text: String(n), 'aria-hidden': 'true' }));
  }));
}

function render() {
  const main = $('#main'), now = Date.now();
  $('#addbar').hidden = !state.profile.setup;
  $('#micBtn').hidden = !canSpeak;
  renderTabs();
  if (!state.profile.setup) { if (!main.querySelector('.welcome')) main.replaceChildren(welcome()); return; } // never redraw over names being typed

  const mine = state.tasks.filter((t) => t.list === view.list);
  let rows = arrange(mine, now);
  const openCount = rows.length;
  const today = rows.filter((r) => r.task.due && r.task.due <= endOfDay(now) && r.task.due >= now).length;
  const late = rows.filter((r) => r.task.due && r.task.due < now).length;
  if (view.fit) rows = rows.filter((r) => effectiveSize(r.task) <= view.fit);

  const d = new Date(now);
  const sub = [];
  if (late) sub.push(late + ' overdue');
  if (today) sub.push(today + ' due today');
  const out = [
    el('section', { class: 'summary' },
      el('p', { class: 'eyebrow', text: DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] }),
      el('h2', { text: openCount === 0 ? 'Nothing to do' : openCount === 1 ? '1 job to do' : openCount + ' jobs to do' }),
      sub.length ? el('p', { class: 'sub', text: sub.join(', ') + '.' }) : null,
      openCount ? el('button', { type: 'button', class: 'fitrow' + (view.fit ? ' on' : ''), onclick: openFit },
        view.fit
          ? el('span', {}, 'Showing jobs that fit ', el('b', { text: minutesWords(view.fit) }))
          : el('span', {}, el('b', { text: 'Short of time?' }), ' See what fits'),
        el('span', { class: 'go', text: view.fit ? 'Change' : 'Choose' })) : null),
  ];

  const fresh = rows.filter((r) => !isStale(r.task, now)), stale = rows.filter((r) => isStale(r.task, now));
  BANDS.forEach((name, i) => {
    const inBand = fresh.filter((r) => r.band === i);
    if (!inBand.length) return;
    out.push(el('section', { class: 'band' },
      el('h3', {}, name, el('small', { text: String(inBand.length) })),
      i === 2 ? el('p', { class: 'note', text: 'Quickest first.' }) : null,
      el('ul', { class: 'jobs' }, inBand.map((r) => jobRow(r.task, now)))));
  });
  if (stale.length) {
    out.push(el('section', { class: 'band' },
      el('h3', {}, 'Still want these?', el('small', { text: String(stale.length) })),
      el('p', { class: 'note', text: 'No date, and here for a fortnight or more.' }),
      el('ul', { class: 'jobs' }, stale.map((r) => jobRow(r.task, now, { stale: true })))));
  }
  if (!rows.length) {
    out.push(el('div', { class: 'empty' },
      el('div', { class: 'bigring', 'aria-hidden': 'true' }),
      el('h3', { text: view.fit && openCount ? 'Nothing that quick' : 'All clear' }),
      el('p', { text: view.fit && openCount ? 'No job here fits ' + minutesWords(view.fit) + '.' : 'Add a job below, by typing or by speaking.' }),
      view.fit && openCount ? el('button', { type: 'button', class: 'linkbtn', text: 'Show everything', onclick: () => { view.fit = 0; render(); } }) : null));
  }

  const doneToday = mine.filter((t) => t.doneAt && t.doneAt >= startOfDay(now)).sort((a, b) => b.doneAt - a.doneAt);
  if (doneToday.length) {
    const wasOpen = !!(main.querySelector('details.donebox') || {}).open;
    out.push(el('details', { class: 'donebox', open: wasOpen },
      el('summary', { text: 'Done today (' + doneToday.length + ')' }),
      el('ul', { class: 'jobs' }, doneToday.map((t) => jobRow(t, now)))));
  }
  main.replaceChildren(...out);
}

function welcome() {
  const me = el('input', { type: 'text', id: 'wMe', autocomplete: 'given-name', autocapitalize: 'words', maxlength: '24' });
  const them = el('input', { type: 'text', id: 'wThem', autocomplete: 'off', autocapitalize: 'words', maxlength: '24' });
  const go = () => {
    const a = me.value.trim(), b = them.value.trim();
    if (!a || !b) { toast('Add both names to begin'); (a ? them : me).focus(); return; }
    state.profile.names[store.me()] = a; state.profile.names[store.other()] = b; state.profile.setup = true;
    if (!state.labels.length) {
      state.labels = [['House', 'plum'], ['Garden', 'sage'], ['Out and about', 'sea'], ['Phone and paperwork', 'gold']]
        .map(([name, colour]) => ({ id: store.uid(), name, colour }));
    }
    store.save();
  };
  return el('section', { class: 'welcome' },
    el('div', { class: 'bigmark', 'aria-hidden': 'true' }, el('span', { class: 'ring' }), 'TUIT'),
    el('h2', { class: 'strap', text: 'The jobs you will do when you get a round tuit.' }),
    el('p', { class: 'hint', text: 'Two lists, one for each of you, and one for either of you. Quick jobs first; dated jobs climb as the day comes.' }),
    el('label', { class: 'lab', for: 'wMe', text: 'Your first name' }), me,
    el('label', { class: 'lab', for: 'wThem', text: 'The other person\'s first name' }), them,
    el('button', { type: 'button', class: 'primary', text: 'Start', onclick: go }));
}

/* ---------- sheets ---------- */
function openSheet(title, body, onclose) {
  stopSpeech();
  const head = el('div', { class: 'sheethead' },
    el('h2', { id: 'sheetTitle', text: title }),
    el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Close', svg: CLOSE, onclick: () => sheet.close() }));
  sheet.setAttribute('aria-labelledby', 'sheetTitle');
  sheet.replaceChildren(head, el('div', { class: 'sheetbody' }, body));
  sheet.onclose = () => { stopSpeech(); sheet.replaceChildren(); if (onclose) onclose(); render(); };
  if (!sheet.open) sheet.showModal();
  sheet.focus(); // start on the sheet itself, not its close button, so no focus ring shows on opening
  sheet.scrollTop = 0;
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

function setFill(range) {
  const min = Number(range.min), max = Number(range.max);
  range.style.setProperty('--p', ((Number(range.value) - min) / (max - min)) * 100 + '%');
}

function selectRow(labelText, options, value, onchange, id) {
  const sel = el('select', { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, text]) => el('option', { value: v, text, selected: v === value })));
  sel.value = value;
  return { row: el('label', { class: 'row', for: id }, el('span', { text: labelText }), sel), sel };
}

function localInput(ms) { // for <input type="datetime-local">
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Add a job, or change one. opts.speak starts listening straight away.
function openJob(task, opts) {
  const o = opts || {}, adding = !task, now = Date.now();
  const stops = whenStops(now);
  const f = adding
    ? { due: null, hasTime: false, size: 15, sizeFrom: 'guess', list: view.list, remind: 'quiet', label: '', repeat: '', steps: [] }
    : { due: task.due, hasTime: task.hasTime, size: task.size, sizeFrom: task.sizeFrom, list: task.list, remind: task.remind, label: task.label, repeat: task.repeat, steps: (task.steps || []).map((s) => Object.assign({}, s)) };
  const touched = { when: false, size: false, list: false, remind: false };
  let stopLabel = '';

  const title = el('textarea', { id: 'jt', rows: '2', placeholder: adding ? 'Ring the plumber by 3 today' : '', autocapitalize: 'sentences', enterkeyhint: 'done', value: adding ? '' : task.title });
  const understood = el('p', { class: 'understood', 'aria-live': 'polite' });
  const speak = speakButton(title, toast);

  // When
  const whenOut = el('output', { id: 'whenOut', for: 'whenRange' });
  const whenRange = el('input', { type: 'range', id: 'whenRange', min: '0', max: String(stops.length - 1), step: '1', value: '0', 'aria-label': 'When' });
  const picker = el('input', { type: 'datetime-local', id: 'whenPick', 'aria-label': 'Date and time', hidden: true });
  const pickBtn = el('button', { type: 'button', class: 'linkbtn', text: 'Pick a date and time', onclick: () => {
    picker.hidden = !picker.hidden;
    if (!picker.hidden) { picker.value = localInput(f.due || now + 60 * MIN); picker.focus(); }
  } });
  const bucket = () => {
    if (!f.due) return 0;
    for (let i = 1; i < stops.length; i++) if (f.due <= stops[i].due) return i;
    return stops.length - 1;
  };
  const showWhen = (fromSlider) => {
    if (!fromSlider) { whenRange.value = String(bucket()); stopLabel = ''; }
    const words = whenWords(f.due, f.hasTime, now);
    const text = stopLabel && f.due ? stopLabel + ': ' + words.charAt(0).toLowerCase() + words.slice(1) : words;
    whenOut.textContent = text; whenRange.setAttribute('aria-valuetext', text); setFill(whenRange);
    remind.sel.disabled = !f.due; remindNote.textContent = remindWords();
  };
  whenRange.addEventListener('input', () => {
    const s = stops[Number(whenRange.value)];
    f.due = s.due; f.hasTime = s.hasTime; touched.when = true; stopLabel = s.due ? s.label : '';
    showWhen(true);
  });
  picker.addEventListener('input', () => {
    if (!picker.value) return;
    const ms = new Date(picker.value).getTime();
    if (isNaN(ms)) return;
    f.due = ms; f.hasTime = true; touched.when = true; showWhen(false);
  });

  // How long
  const sizeOut = el('output', { id: 'sizeOut', for: 'sizeRange' });
  const sizeRange = el('input', { type: 'range', id: 'sizeRange', min: '0', max: String(SIZES.length - 1), step: '1', 'aria-label': 'How long it takes' });
  const showSize = () => {
    sizeRange.value = String(sizeIndex(f.size));
    const text = SIZES[sizeIndex(f.size)].long + (f.sizeFrom === 'guess' ? ' (a guess)' : '');
    sizeOut.textContent = text; sizeRange.setAttribute('aria-valuetext', text); setFill(sizeRange);
  };
  sizeRange.addEventListener('input', () => { f.size = SIZES[Number(sizeRange.value)].min; f.sizeFrom = 'you'; touched.size = true; showSize(); });

  // Plain rows
  const lists = [store.me(), store.other(), 'either'].map((id) => [id, id === store.me() ? 'Mine' : store.listTitle(id) + (id === 'either' ? '' : ' list')]);
  const list = selectRow('Whose list', lists, f.list, (v) => { f.list = v; touched.list = true; }, 'jList');
  const remindNote = el('p', { class: 'rownote' });
  const remindWords = () => !f.due ? 'Give the job a date to set a reminder.'
    : f.remind === 'buzzer' ? 'Fills the screen and sounds until the job is ticked. Silence only pauses it for 10 minutes.'
    : f.remind === 'nudge' ? 'Reminds you every 15 minutes until the job is ticked.'
    : f.hasTime ? 'One reminder at the time you set.' : 'One reminder at 9 am on the day.';
  const remind = selectRow('Reminder', LEVELS.map((l) => [l.key, l.name + ': ' + l.note]), f.remind, (v) => { f.remind = v; touched.remind = true; remindNote.textContent = remindWords(); }, 'jRemind');
  const colour = selectRow('Colour', [['', 'None']].concat(state.labels.map((l) => [l.id, l.name])), f.label, (v) => { f.label = v; }, 'jColour');
  const repeat = selectRow('Repeats', REPEATS, f.repeat, (v) => { f.repeat = v; }, 'jRepeat');

  // Steps
  const stepList = el('ul', { class: 'steps rows' });
  const drawSteps = () => {
    stepList.hidden = !f.steps.length;
    stepList.replaceChildren(...f.steps.map((s, i) => el('li', {},
      el('label', { class: 'cb' }, el('input', { type: 'checkbox', checked: s.done, 'aria-label': 'Step done: ' + s.title, onchange: (e) => { s.done = e.target.checked; } })),
      el('input', { type: 'text', value: s.title, 'aria-label': 'Step ' + (i + 1), oninput: (e) => { s.title = e.target.value; } }),
      el('button', { type: 'button', class: 'x', 'aria-label': 'Remove step: ' + s.title, svg: CLOSE, onclick: () => { f.steps.splice(i, 1); drawSteps(); } }))));
  };
  const stepNew = el('input', { type: 'text', id: 'stepNew', placeholder: 'A first step', enterkeyhint: 'done', autocapitalize: 'sentences' });
  const addStep = () => {
    const v = stepNew.value.trim();
    if (!v) { stepNew.focus(); return; }
    f.steps.push({ id: store.uid(), title: v, done: false }); stepNew.value = ''; drawSteps(); stepNew.focus();
  };
  stepNew.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });

  // Reading the sentence as it is typed or spoken (new jobs only).
  const ctx = () => ({ now: Date.now(), me: store.me(), other: store.other(), otherName: state.profile.names[store.other()] });
  const read = () => {
    if (!adding) return;
    const raw = title.value, p = parseSentence(raw, ctx());
    if (!touched.when) { f.due = p.due; f.hasTime = p.hasTime; showWhen(false); }
    if (!touched.list) { f.list = p.list || view.list; list.sel.value = f.list; }
    if (!touched.size) { f.size = p.size ? SIZES[sizeIndex(p.size)].min : guessSize(p.title); f.sizeFrom = p.size ? 'said' : 'guess'; showSize(); }
    if (!touched.remind && p.remind) { f.remind = p.remind; remind.sel.value = f.remind; remindNote.textContent = remindWords(); }
    const clean = p.title && p.title !== raw.trim();
    understood.replaceChildren(...(clean ? ['Will save as ', el('b', { text: p.title })] : []));
  };
  title.addEventListener('input', read);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveJob(); } });

  const saveJob = () => {
    const raw = title.value.trim();
    const name = adding ? (parseSentence(raw, ctx()).title || raw) : raw;
    if (!name) { toast('Say or type what needs doing'); title.focus(); return; }
    const pending = stepNew.value.trim();
    if (pending) f.steps.push({ id: store.uid(), title: pending, done: false });
    const steps = f.steps.filter((s) => s.title.trim()).map((s) => ({ id: s.id, title: s.title.trim(), done: !!s.done }));
    if (f.repeat && !f.due) { f.due = endOfDay(Date.now()); f.hasTime = false; }
    const fields = { title: name, due: f.due, hasTime: f.hasTime, size: f.size, sizeFrom: f.sizeFrom, list: f.list, remind: f.remind, label: f.label, repeat: f.repeat, steps };
    if (adding) {
      state.tasks.push(store.newTask(fields));
      sheet.close(); store.save();
      toast(f.list === view.list ? 'Added: ' + name : 'Added to ' + (f.list === 'either' ? 'Either of us' : store.listTitle(f.list) + ' list'));
    } else {
      if (task.due !== f.due) { task.alertedAt = 0; task.silencedUntil = 0; }
      Object.assign(task, fields, { updatedAt: Date.now() });
      sheet.close(); store.save();
    }
  };

  let sure = false;
  const del = adding ? null : el('button', { type: 'button', class: 'second danger', text: 'Delete this job', onclick: (e) => {
    if (!sure) { sure = true; e.target.textContent = 'Tap again to delete'; return; }
    sheet.close(); removeTask(task);
  } });

  const body = [
    el('label', { class: 'lab', for: 'jt', text: 'What needs doing?' }),
    title, speak,
    adding ? understood : null,
    el('div', { class: 'field' },
      el('div', { class: 'top' }, el('label', { class: 'lab', for: 'whenRange', text: 'When' }), whenOut),
      whenRange,
      el('div', { class: 'ends', 'aria-hidden': 'true' }, el('span', { text: 'No date' }), el('span', { text: 'Next week' })),
      pickBtn, picker),
    el('div', { class: 'field' },
      el('div', { class: 'top' }, el('label', { class: 'lab', for: 'sizeRange', text: 'How long' }), sizeOut),
      sizeRange,
      el('div', { class: 'ends', 'aria-hidden': 'true' }, el('span', { text: '5 minutes' }), el('span', { text: 'A big job' }))),
    el('div', { class: 'rows' }, list.row),
    el('details', { class: 'more', open: !adding },
      el('summary', { text: 'Reminder, colour, repeats and steps' }),
      el('div', { class: 'inner' },
        el('div', { class: 'rows' }, remind.row, remindNote, colour.row,
          state.labels.length ? null : el('p', { class: 'rownote', text: 'Name your colours in Settings first.' }), repeat.row),
        el('p', { class: 'lab', text: 'Steps' }),
        el('p', { class: 'hint', text: 'Break a big job down. The next step shows in your list.' }),
        stepList,
        el('div', { class: 'rows' }, el('div', { class: 'row' }, stepNew)),
        el('button', { type: 'button', class: 'second', text: 'Add this step', onclick: addStep }))),
    el('button', { type: 'button', class: 'primary', text: adding ? 'Save job' : 'Save changes', onclick: saveJob }),
    del,
  ];

  openSheet(adding ? 'New job' : 'Change job', body);
  showSize(); drawSteps(); showWhen(false);
  if (o.speak && speak) speak.click();
  else if (adding) title.focus();
}

function openFit() {
  let idx = Math.max(0, FIT_STOPS.indexOf(view.fit || 10));
  const out = el('output', { for: 'fitRange' });
  const range = el('input', { type: 'range', id: 'fitRange', min: '0', max: String(FIT_STOPS.length - 1), step: '1', value: String(idx), 'aria-label': 'How long have you got' });
  const show = () => { idx = Number(range.value); const t = minutesWords(FIT_STOPS[idx]); out.textContent = t.charAt(0).toUpperCase() + t.slice(1); range.setAttribute('aria-valuetext', t); setFill(range); };
  range.addEventListener('input', show);
  openSheet('How long have you got?', [
    el('div', { class: 'field' },
      el('div', { class: 'top' }, el('label', { class: 'lab', for: 'fitRange', text: 'I have' }), out),
      range,
      el('div', { class: 'ends', 'aria-hidden': 'true' }, el('span', { text: '5 minutes' }), el('span', { text: '2 hours' }))),
    el('button', { type: 'button', class: 'primary', text: 'Show jobs that fit', onclick: () => { view.fit = FIT_STOPS[idx]; sheet.close(); render(); } }),
    view.fit ? el('button', { type: 'button', class: 'second', text: 'Show everything', onclick: () => { view.fit = 0; sheet.close(); render(); } }) : null,
  ]);
  show();
}

async function signOutHere() { await disablePush(sync); await sync.signOutNow(); }

// Closed-app reminders: subscribe when sharing is on and notifications are allowed. Quietly does nothing otherwise.
let pushTried = false;
async function refreshPush(loud) {
  if (!sync || !sync.status().circle) return false;
  try { return await enablePush(sync, state.settings); }
  catch (e) { if (loud) toast('Reminders with the app closed could not be switched on. ' + (e.message || '')); return false; }
}
let quietTimer = null;
function quietChanged() { store.save(); clearTimeout(quietTimer); if (pushOn()) quietTimer = setTimeout(() => refreshPush(false), 800); }

// The Sharing part of Settings. It redraws itself as sign-in and the shared list change.
let joinCode = new URLSearchParams(location.search).get('join') || '';
function sharingBox() {
  const box = el('div', { class: 'sharebox' });
  let last = '', code = '', stop = null;
  const run = (fn) => async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message || 'That did not work. Try again in a moment.'); }
    btn.disabled = false;
  };
  const myName = () => state.profile.names[store.me()] || 'Me';
  const draw = () => {
    const st = sync ? sync.status() : null;
    const mode = !canShare ? 'off' : shareFailed ? 'failed' : !st || !st.ready ? 'wait' : !st.user ? 'out' : !st.circle ? 'alone' : st.members.length < 2 ? 'invite' : 'both';
    const key = mode + '|' + (st ? st.problem : '') + '|' + code + '|' + (st && st.user ? st.user.email : '') + '|' + (st ? st.members.map((m) => m.name).join() : '');
    if (key === last) return;
    last = key;
    const out = [];
    if (st && st.problem) out.push(el('p', { class: 'hint danger', text: st.problem }));
    if (mode === 'off') out.push(el('p', { class: 'hint', text: 'Your jobs are kept on this phone. Sharing between your two phones is not switched on yet.' }));
    else if (mode === 'failed') out.push(el('p', { class: 'hint', text: 'Sharing could not start. Check the signal, then close and open Round TUIT.' }));
    else if (mode === 'wait') out.push(el('p', { class: 'hint', text: 'Checking the shared list.' }));
    else if (mode === 'out') {
      const email = el('input', { type: 'email', id: 'shEmail', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email' });
      const pass = el('input', { type: 'password', id: 'shPass', autocomplete: 'current-password' });
      const need = () => {
        if (!email.value.trim()) { email.focus(); throw new Error('Add your email address.'); }
        if (pass.value.length < 8) { pass.focus(); throw new Error('Use a password of 8 characters or more.'); }
      };
      out.push(
        el('p', { class: 'hint', text: 'To see each other\'s jobs, each of you signs in on your own phone with your own email. The first time, use Create an account.' }),
        el('label', { class: 'lab', for: 'shEmail', text: 'Email' }), email,
        el('label', { class: 'lab', for: 'shPass', text: 'Password' }), pass,
        el('button', { type: 'button', class: 'primary', text: 'Sign in', onclick: run(async () => { need(); await sync.signIn(email.value, pass.value); }) }),
        el('button', { type: 'button', class: 'second', text: 'Create an account', onclick: run(async () => { need(); await sync.signUp(email.value, pass.value); }) }),
        el('button', { type: 'button', class: 'linkbtn', text: 'Forgotten your password?', onclick: run(async () => {
          if (!email.value.trim()) { email.focus(); throw new Error('Add your email address first.'); }
          await sync.resetPassword(email.value); toast('If that email has an account, a reset link is on its way.');
        }) }));
    } else if (mode === 'alone') {
      const codeIn = el('input', { type: 'text', id: 'shCode', value: joinCode, maxlength: '12', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: '8 letters and numbers' });
      out.push(
        el('p', { class: 'hint', text: 'Signed in as ' + st.user.email + '.' }),
        el('button', { type: 'button', class: 'primary', text: 'Start a shared list from this phone', onclick: run(async () => { await sync.startSharing(myName()); }) }),
        el('p', { class: 'hint', text: 'Or, if the other phone has already started one, type its code here.' }),
        el('label', { class: 'lab', for: 'shCode', text: 'Code from the other phone' }), codeIn,
        el('button', { type: 'button', class: 'second', text: 'Join with this code', onclick: run(async () => {
          if (!codeIn.value.trim()) { codeIn.focus(); throw new Error('Type the code from the other phone.'); }
          await sync.join(codeIn.value, myName()); joinCode = '';
        }) }),
        el('button', { type: 'button', class: 'linkbtn', text: 'Sign out on this phone', onclick: run(signOutHere) }));
    } else if (mode === 'invite') {
      out.push(el('p', { class: 'hint', text: 'Sharing is on for this phone. Now add the other phone.' }));
      if (code) {
        const words = 'Join my Round TUIT list. In Round TUIT open Settings, then Sharing, sign in, and type this code: ' + code;
        out.push(
          el('p', { class: 'code', text: code, 'aria-label': 'Code: ' + code.split('').join(' ') }),
          el('p', { class: 'hint', text: 'On the other phone: Settings, Sharing, create an account, then type this code. It works once, and for 7 days.' }),
          navigator.share ? el('button', { type: 'button', class: 'second', text: 'Send the code', onclick: run(async () => { try { await navigator.share({ text: words }); } catch (e) { /* closed without sending */ } }) }) : null);
      }
      out.push(
        el('button', { type: 'button', class: code ? 'second' : 'primary', text: code ? 'Make a new code' : 'Make a code for the other phone', onclick: run(async () => { code = (await sync.invite()).code; draw(); }) }),
        el('button', { type: 'button', class: 'linkbtn', text: 'Sign out on this phone', onclick: run(signOutHere) }));
    } else {
      const them = st.members.find((m) => m.seat !== st.seat);
      out.push(
        el('p', { class: 'hint' }, 'Sharing with ', el('b', { text: them ? them.name : 'the other phone' }), '. A change on one phone shows on the other.'),
        el('p', { class: 'hint', text: 'Signed in as ' + st.user.email + '.' }),
        el('button', { type: 'button', class: 'linkbtn', text: 'Sign out on this phone', onclick: run(signOutHere) }));
    }
    box.replaceChildren(...out.filter(Boolean));
  };
  if (sync) stop = sync.onStatus(draw);
  return { box, draw, stop: () => { if (stop) stop(); } };
}

function openSettings() {
  const names = state.profile.names;
  const shared = () => !!(sync && sync.status().circle);
  const meIn = el('input', { type: 'text', id: 'sMe', value: names[store.me()], maxlength: '24', autocapitalize: 'words',
    oninput: (e) => { names[store.me()] = e.target.value.trim(); store.save(); },
    onchange: (e) => { const v = e.target.value.trim(); if (v && shared()) sync.rename(v).catch((err) => toast(err.message)); } });
  // Once the other phone has joined, its owner chooses the name shown here.
  const themJoined = shared() && sync.status().members.length > 1;
  const themIn = el('input', { type: 'text', id: 'sThem', value: names[store.other()], maxlength: '24', autocapitalize: 'words', disabled: themJoined, oninput: (e) => { names[store.other()] = e.target.value.trim(); store.save(); } });
  const share = sharingBox();

  const colourBox = el('div', { class: 'rows' });
  const drawColours = () => {
    colourBox.hidden = !state.labels.length;
    colourBox.replaceChildren(...state.labels.map((l) => {
      const sw = el('span', { class: 'swatch', style: '--c: var(--c-' + l.colour + ')', 'aria-hidden': 'true' });
      return el('div', { class: 'colourrow' }, sw,
        el('input', { type: 'text', value: l.name, maxlength: '24', 'aria-label': 'Name for ' + l.colour, oninput: (e) => { l.name = e.target.value; store.save(); } }),
        el('select', { 'aria-label': 'Colour for ' + l.name, onchange: (e) => { l.colour = e.target.value; sw.style.setProperty('--c', 'var(--c-' + l.colour + ')'); store.save(); } },
          store.COLOURS.map((c) => el('option', { value: c.key, text: c.name, selected: c.key === l.colour }))),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + l.name, svg: CLOSE, onclick: () => {
          state.labels = state.labels.filter((x) => x.id !== l.id);
          state.tasks.forEach((t) => { if (t.label === l.id) t.label = ''; });
          store.save(); drawColours();
        } }));
    }));
  };
  const addColour = () => {
    const used = state.labels.map((l) => l.colour);
    const free = store.COLOURS.find((c) => !used.includes(c.key)) || store.COLOURS[0];
    state.labels.push({ id: store.uid(), name: 'New colour', colour: free.key });
    store.save(); drawColours();
    const ins = colourBox.querySelectorAll('input[type="text"]'); const last = ins[ins.length - 1];
    if (last) { last.focus(); last.select(); }
  };

  const noteState = el('p', { class: 'rownote' });
  const noteBtn = el('button', { type: 'button', class: 'second', text: 'Turn on notifications', onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true; unlockSound();
    if (notifyState() === 'default') await askToNotify();
    if (notifyState() === 'granted') await refreshPush(true);
    btn.disabled = false; drawNote();
  } });
  const drawNote = () => {
    const s = notifyState(), sharedOn = !!(sync && sync.status().circle);
    const wantPush = s === 'granted' && sharedOn && canPush() && !pushOn();
    noteBtn.hidden = !(s === 'default' || wantPush);
    noteBtn.textContent = s === 'default' ? 'Turn on notifications' : 'Get reminders with the app closed';
    noteState.textContent = s === 'granted' && pushOn() ? 'Reminders reach this phone even with Round TUIT closed.'
      : s === 'granted' && !sharedOn ? 'Notifications are on. Reminders with the app closed start once sharing is on.'
      : s === 'granted' ? 'Notifications are on for this phone.'
      : s === 'denied' ? 'Notifications are switched off for Round TUIT in this phone\'s Settings.'
      : s === 'unsupported' ? 'On iPhone, add Round TUIT to the Home Screen first (Share, then Add to Home Screen). Notifications work from there.'
      : 'Reminders show while Round TUIT is open. Turn on notifications to get them when it is in the background too.';
  };

  const s = state.settings;
  const body = [
    el('h3', { class: 'sechead', text: 'Sharing' }),
    share.box,

    el('h3', { class: 'sechead', text: 'Who is who' }),
    el('div', { class: 'rows' },
      el('label', { class: 'row', for: 'sMe' }, el('span', { text: 'You' }), meIn),
      el('label', { class: 'row', for: 'sThem' }, el('span', { text: 'The other list' }), themIn)),

    el('h3', { class: 'sechead', text: 'Colours' }),
    el('p', { class: 'hint', text: 'Name a colour for anything you like: a room, a kind of job, a person. Give a job its colour when you add or change it.' }),
    colourBox,
    el('button', { type: 'button', class: 'second', text: 'Add a colour', onclick: addColour }),

    el('h3', { class: 'sechead', text: 'Reminders' }),
    el('div', { class: 'rows' }, noteState,
      el('label', { class: 'row', for: 'qOn' }, el('span', { text: 'Quiet hours' }),
        el('input', { type: 'checkbox', class: 'switch', id: 'qOn', checked: s.quietOn, onchange: (e) => { s.quietOn = e.target.checked; quietChanged(); } })),
      el('label', { class: 'row', for: 'qFrom' }, el('span', { text: 'From' }), el('input', { type: 'time', id: 'qFrom', value: s.quietFrom, onchange: (e) => { if (e.target.value) { s.quietFrom = e.target.value; quietChanged(); } } })),
      el('label', { class: 'row', for: 'qTo' }, el('span', { text: 'Until' }), el('input', { type: 'time', id: 'qTo', value: s.quietTo, onchange: (e) => { if (e.target.value) { s.quietTo = e.target.value; quietChanged(); } } })),
      el('p', { class: 'rownote', text: 'In quiet hours a Nudge waits until morning. A Buzzer you set for a time still sounds.' })),
    noteBtn,
    el('button', { type: 'button', class: 'second', text: 'Try the buzzer', onclick: () => { sheet.close(); openBuzzer(null); } }),

    el('h3', { class: 'sechead', text: 'About' }),
    el('a', { class: 'second linkrow', href: 'device.html', text: 'Screen check' }),
    el('p', { class: 'about', text: 'Round TUIT, version 0.3. Made by Mark 1 Apps Ltd.' }),
  ];
  openSheet('Settings', body, share.stop);
  drawColours(); drawNote(); share.draw();
}

/* ---------- the buzzer ---------- */
let buzzingId = null;
function openBuzzer(task) {
  const now = Date.now(), test = !task;
  buzzingId = test ? 'test' : task.id;
  const closeIt = () => { stopSound(); buzzingId = null; if (buzzer.open) buzzer.close(); buzzer.replaceChildren(); };
  buzzer.replaceChildren(el('div', { class: 'bz-in' },
    el('div', { class: 'bz-ring', 'aria-hidden': 'true' }),
    el('p', { class: 'eyebrow', text: 'Time to' }),
    el('h2', { id: 'bzTitle', text: test ? 'Try the buzzer' : task.title }),
    el('p', { class: 'bz-due', text: test ? 'This is how a Buzzer job looks and sounds.' : (dueWords(task, now).text || 'Now') + ' · ' + store.listTitle(task.list) }),
    el('button', { type: 'button', class: 'bz-done', text: 'Done', onclick: () => { closeIt(); if (!test) completeTask(task); } }),
    el('button', { type: 'button', class: 'bz-silence', text: 'Silence for 10 minutes', onclick: () => {
      closeIt();
      if (!test) { task.silencedUntil = Date.now() + SILENCE_FOR; store.save(); toast('Silenced for 10 minutes. It will come back.'); }
    } }),
    el('p', { class: 'bz-note', text: 'It keeps coming back until the job is ticked.' })));
  if (sheet.open) sheet.close();
  if (!buzzer.open) buzzer.showModal();
  startSound();
}
buzzer.addEventListener('cancel', (e) => e.preventDefault()); // no way out but Done or Silence

/* ---------- start ---------- */
watchTextSize();
store.subscribe(() => { if (!sheet.open || !sheet.querySelector('#jt')) render(); });
$('#settingsBtn').addEventListener('click', openSettings);
$('#addBtn').addEventListener('click', () => openJob(null));
$('#micBtn').addEventListener('click', () => openJob(null, { speak: true }));
document.addEventListener('pointerdown', unlockSound, { passive: true });
render();
store.save();

startReminders({ toast, openBuzzer, buzzerOpenFor: () => buzzingId, pushOn });

if (canShare) {
  let wasMe = store.me();
  import('./sync.js').then((m) => {
    sync = m;
    m.onStatus(() => {
      // A phone that joins takes the second place, so "Mine" moves with it.
      if (store.me() !== wasMe) { if (view.list !== 'either') view.list = view.list === wasMe ? store.me() : store.other(); wasMe = store.me(); }
      if (!sheet.open) render(); else renderTabs();
      if (!pushTried && m.status().circle && notifyState() === 'granted') { pushTried = true; refreshPush(false); }
    });
    return m.start();
  }).catch(() => { shareFailed = true; });
  if (joinCode && state.profile.setup) setTimeout(openSettings, 600);
}
setInterval(() => { if (!sheet.open && !buzzer.open && !document.hidden) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheet.open) render(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.open) openFromReminder(e.data.open); });
}

// A tapped reminder opens its job; a Buzzer job opens the buzzer. The job may still be on its way from
// the shared list, so look again for a few seconds.
function openFromReminder(id, tries) {
  const t = store.findTask(id);
  if (!t) { if ((tries || 0) < 10) setTimeout(() => openFromReminder(id, (tries || 0) + 1), 500); return; }
  if (t.doneAt) return;
  view.list = t.list === store.me() || t.list === 'either' ? t.list : view.list;
  render();
  if (t.remind === 'buzzer') openBuzzer(t); else openJob(t);
}
const openParam = new URLSearchParams(location.search).get('open');
if (openParam && state.profile.setup) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => openFromReminder(openParam), 300);
}
