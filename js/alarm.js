// Reminders while the app is open: Quiet (once), Nudge (every 15 minutes), Buzzer (until done).
// Reminders when the app is closed need a server, which comes with sharing.

import { MIN, alertAt } from './order.js';
import * as store from './store.js';

export const NUDGE_EVERY = 15 * MIN;
export const SILENCE_FOR = 10 * MIN;
export const BUZZ_NOTIFY_EVERY = 2 * MIN;

export const LEVELS = [
  { key: 'quiet', name: 'Quiet', note: 'one reminder' },
  { key: 'nudge', name: 'Nudge', note: 'every 15 minutes' },
  { key: 'buzzer', name: 'Buzzer', note: 'until it is done' },
];

function inQuietHours(now, settings) {
  if (!settings.quietOn) return false;
  const d = new Date(now), mins = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = settings.quietFrom.split(':').map(Number), [th, tm] = settings.quietTo.split(':').map(Number);
  const from = fh * 60 + fm, to = th * 60 + tm;
  return from <= to ? mins >= from && mins < to : mins >= from || mins < to;
}

// What should happen now. Pure, so it can be tested: returns { notify: [task], buzz: [task] }.
export function dueAlerts(tasks, now, settings) {
  const notify = [], buzz = [];
  const quiet = inQuietHours(now, settings);
  for (const t of tasks) {
    if (t.doneAt || !t.due) continue;
    const at = alertAt(t);
    if (now < at) continue;
    const first = !t.alertedAt || t.alertedAt < at;
    if (t.remind === 'buzzer') {
      if (now < (t.silencedUntil || 0)) continue;
      if (quiet && !t.hasTime) continue;
      buzz.push(t);
    } else if (t.remind === 'nudge') {
      if (first || (!quiet && now - t.alertedAt >= NUDGE_EVERY)) notify.push(t);
    } else if (first) notify.push(t);
  }
  return { notify, buzz };
}

// The sound: two short notes, over and over, while the buzzer is on screen.
let ctx = null, beepTimer = null;
export function unlockSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* no sound here */ }
}
function beep() {
  if (!ctx || ctx.state !== 'running') return;
  [0, 0.22].forEach((offset, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + offset;
    o.type = 'triangle'; o.frequency.value = i ? 988 : 784;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.2);
  });
  if (navigator.vibrate) { try { navigator.vibrate([180, 80, 180]); } catch (e) {} }
}
export function startSound() { unlockSound(); stopSound(); beep(); beepTimer = setInterval(beep, 1100); }
export function stopSound() { clearInterval(beepTimer); beepTimer = null; }

export function canNotify() { return 'Notification' in window; }
export function notifyState() { return canNotify() ? Notification.permission : 'unsupported'; }
export async function askToNotify() {
  if (!canNotify()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
}
export async function showNotification(task, body) {
  if (notifyState() !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    const opts = { body, tag: task.id, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id: task.id } };
    if (reg) await reg.showNotification(task.title, opts);
    else new Notification(task.title, opts);
  } catch (e) { /* the phone refused: the in-app reminder still shows */ }
}

// Runs the check. ui: { toast(text), openBuzzer(task), buzzerOpenFor() }
export function startReminders(ui) {
  const lastBuzzNote = new Map();
  const tick = () => {
    const state = store.get(), now = Date.now();
    const { notify, buzz } = dueAlerts(state.tasks, now, state.settings);
    let changed = false;
    for (const t of notify) {
      t.alertedAt = now; changed = true;
      if (document.hidden) showNotification(t, t.remind === 'nudge' ? 'Still to do' : 'Time to do this');
      else ui.toast('Time to: ' + t.title);
    }
    if (buzz.length) {
      const t = buzz[0];
      if (!t.alertedAt) { t.alertedAt = now; changed = true; }
      if (document.hidden) {
        if (now - (lastBuzzNote.get(t.id) || 0) >= BUZZ_NOTIFY_EVERY) { lastBuzzNote.set(t.id, now); showNotification(t, 'Open Round TUIT to tick it off or silence it'); }
      } else if (ui.buzzerOpenFor() !== t.id) ui.openBuzzer(t);
    }
    if (changed) store.save();
  };
  tick();
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return tick;
}
