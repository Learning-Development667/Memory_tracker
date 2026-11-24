// Reminders with the app closed: this phone subscribes to web push and tells the bridge where to send.
// On iPhone this only works from the Home Screen app, after the person allows notifications.

let on = false;
export function pushOn() { return on; }
export function canPush() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

function b64uToBytes(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function bytesToB64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// sync: the module from js/sync.js. settings: the app's quiet hours.
export async function enablePush(sync, settings) {
  if (!canPush() || Notification.permission !== 'granted' || !sync.status().circle) { on = false; return false; }
  const reg = await navigator.serviceWorker.ready;
  const { key } = await sync.call('/push-key');
  let sub = await reg.pushManager.getSubscription();
  const had = sub && sub.options && sub.options.applicationServerKey;
  if (sub && had && bytesToB64u(had) !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  await sync.call('/push', {
    subscription: sub.toJSON(),
    quiet: { on: settings.quietOn, from: settings.quietFrom, to: settings.quietTo },
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  on = true;
  return true;
}

export async function disablePush(sync) {
  on = false;
  try { await sync.call('/push-off'); } catch (e) { /* signed out already */ }
}
