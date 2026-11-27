// What the app remembers. Always kept on this phone; when sharing is on, also kept in step
// with the shared copy through the functions js/sync.js hands to attachRemote().

import { alertAt } from './order.js';

const KEY = 'round-tuit-v1';
const KEEP_DONE_DAYS = 30;

export const COLOURS = [
  { key: 'plum', name: 'Plum' },
  { key: 'apricot', name: 'Apricot' },
  { key: 'sage', name: 'Sage' },
  { key: 'sea', name: 'Sea blue' },
  { key: 'teal', name: 'Teal' },
  { key: 'rose', name: 'Rose' },
  { key: 'gold', name: 'Gold' },
  { key: 'slate', name: 'Slate' },
];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fresh() {
  return {
    v: 1,
    profile: { setup: false, me: 'a', names: { a: '', b: '' }, circle: '' },
    labels: [],
    settings: { quietOn: true, quietFrom: '22:00', quietTo: '07:00' },
    tasks: [],
    known: [], // ids of jobs the shared copy has seen, so a job removed on the other phone is not put back
  };
}

let state = fresh();
const listeners = new Set();

function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* carry on in memory */ } }
function notify() { listeners.forEach((fn) => fn(state)); }
function prune() {
  const cut = Date.now() - KEEP_DONE_DAYS * 86400000;
  state.tasks = state.tasks.filter((t) => !t.doneAt || t.doneAt >= cut);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const got = JSON.parse(raw);
      if (got && got.v === 1) {
        state = Object.assign(fresh(), got);
        state.profile = Object.assign(fresh().profile, got.profile);
      }
    }
  } catch (e) { /* storage refused: carry on in memory */ }
  prune();
  return state;
}

export function get() { return state; }

export function save() {
  persist();
  pushDiff();
  notify();
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function snapshot() { return JSON.stringify(state.tasks); }
export function restore(snap) {
  const old = new Map(state.tasks.map((t) => [t.id, t]));
  state.tasks = JSON.parse(snap).map((t) => { const had = old.get(t.id); return had ? refill(had, t) : t; });
  save();
}

export function me() { return state.profile.me; }
export function other() { return state.profile.me === 'a' ? 'b' : 'a'; }
export function nameOf(id) {
  if (id === 'either') return 'Either of us';
  return state.profile.names[id] || (id === me() ? 'Me' : 'The other list');
}
export function listTitle(id) {
  if (id === 'either') return 'Either of us';
  if (id === me()) return 'Mine';
  const n = state.profile.names[id];
  return n ? n + (/s$/i.test(n) ? "'" : "'s") : 'Theirs';
}

export function newTask(fields) {
  const now = Date.now();
  return Object.assign({
    id: uid(), title: '', list: me(), addedBy: me(), createdAt: now, updatedAt: now,
    due: null, hasTime: false, size: 15, sizeFrom: 'guess', label: '', remind: 'quiet',
    repeat: '', steps: [], workDays: [], doneAt: null, doneBy: null, silencedUntil: 0, alertedAt: 0,
  }, fields);
}

export function findTask(id) { return state.tasks.find((t) => t.id === id); }

/* ---------- keeping in step with the shared copy ---------- */

let remote = null;          // { setTask(task), deleteTask(id), setLabels(labels) }
let tasksReady = false, labelsReady = false;
let synced = new Map();     // id -> the job as the shared copy last had it
let syncedLabels = '';

// The same words whatever order the fields come back in.
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
// Whether this phone has sounded a reminder stays on this phone. alarmAt tells the bridge when to send
// a reminder with the app closed: worked out here, in the phone's own time zone, and empty once done.
function forRemote(t) {
  const c = Object.assign({}, t);
  delete c.alertedAt;
  c.alarmAt = t.doneAt ? null : alertAt(t);
  return c;
}
// Keep the same object, so a job that is open on screen stays the job in the list.
function refill(target, from) {
  const alertedAt = target.alertedAt || 0;
  for (const k of Object.keys(target)) delete target[k];
  return Object.assign(target, from, { alertedAt: from.alertedAt || alertedAt });
}

export function sharing() { return !!remote; }

export function attachRemote(r) {
  remote = r; tasksReady = false; labelsReady = false; synced = new Map(); syncedLabels = '';
}
export function detachRemote() { remote = null; tasksReady = false; labelsReady = false; }

function pushDiff() {
  if (!remote) return;
  if (tasksReady) {
    const seen = new Set();
    for (const t of state.tasks) {
      seen.add(t.id);
      const c = forRemote(t), j = stable(c);
      if (synced.get(t.id) !== j) { synced.set(t.id, j); remote.setTask(JSON.parse(JSON.stringify(c))); }
    }
    for (const id of [...synced.keys()]) if (!seen.has(id)) { synced.delete(id); remote.deleteTask(id); }
    state.known = [...synced.keys()];
  }
  if (labelsReady) {
    const j = stable(state.labels);
    if (j !== syncedLabels) { syncedLabels = j; remote.setLabels(JSON.parse(JSON.stringify(state.labels))); }
  }
}

// The shared copy's jobs have arrived, or changed.
export function applyRemoteTasks(list) {
  const local = new Map(state.tasks.map((t) => [t.id, t]));
  const ids = new Set(list.map((t) => t.id));
  const next = list.map((t) => (local.has(t.id) ? refill(local.get(t.id), t) : Object.assign({ alertedAt: 0 }, t)));
  synced = new Map(list.map((t) => [t.id, stable(forRemote(t))]));
  if (!tasksReady) {
    // First news since opening: jobs made on this phone that the shared copy has never seen go up to it.
    const known = new Set(state.known || []);
    next.push(...state.tasks.filter((t) => !ids.has(t.id) && !known.has(t.id)));
    tasksReady = true;
  }
  state.tasks = next;
  prune();
  persist(); pushDiff(); persist(); notify();
}

export function applyRemoteLabels(list) {
  const local = new Map(state.labels.map((l) => [l.id, l]));
  const next = list.map((l) => (local.has(l.id) ? Object.assign(local.get(l.id), l) : Object.assign({}, l)));
  syncedLabels = stable(list);
  if (!labelsReady) {
    // First news: colours named on this phone that the shared copy does not have are added to it.
    const names = new Set(list.map((l) => String(l.name).toLowerCase()));
    const ids = new Set(list.map((l) => l.id));
    next.push(...state.labels.filter((l) => !ids.has(l.id) && !names.has(String(l.name).toLowerCase())));
    labelsReady = true;
  }
  state.labels = next;
  persist(); pushDiff(); notify();
}

// Which of the two places this phone holds in the shared list. The first phone is 'a', the second 'b'.
// A phone that joins as 'b' has been calling itself 'a' until now, so its own jobs change sides.
export function setSeat(seat, circle) {
  const p = state.profile;
  if (p.circle && p.circle !== circle) { state.tasks = []; state.known = []; }
  else if (!p.circle && seat !== p.me) {
    const flip = (v) => (v === 'a' ? 'b' : v === 'b' ? 'a' : v);
    state.tasks.forEach((t) => { t.list = flip(t.list); t.addedBy = flip(t.addedBy); t.doneBy = flip(t.doneBy); });
    p.names = { a: p.names.b, b: p.names.a };
  }
  p.me = seat; p.circle = circle; p.setup = true;
  persist();
}

export function setNames(names) {
  let changed = false;
  for (const seat of ['a', 'b']) if (names[seat] && state.profile.names[seat] !== names[seat]) { state.profile.names[seat] = names[seat]; changed = true; }
  if (changed) { persist(); notify(); }
}
