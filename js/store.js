// What the app remembers. Kept on this phone for now; sharing between phones plugs in here later.

const KEY = 'round-tuit-v1';

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
    profile: { setup: false, me: 'a', names: { a: '', b: '' } },
    labels: [],
    settings: { quietOn: true, quietFrom: '22:00', quietTo: '07:00' },
    tasks: [],
  };
}

let state = fresh();
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const got = JSON.parse(raw);
      if (got && got.v === 1) state = Object.assign(fresh(), got);
    }
  } catch (e) { /* storage refused: carry on in memory */ }
  return state;
}

export function get() { return state; }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* carry on in memory */ }
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function snapshot() { return JSON.stringify(state.tasks); }
export function restore(snap) { state.tasks = JSON.parse(snap); save(); }

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
    repeat: '', steps: [], doneAt: null, doneBy: null, silencedUntil: 0, alertedAt: 0,
  }, fields);
}

export function findTask(id) { return state.tasks.find((t) => t.id === id); }
