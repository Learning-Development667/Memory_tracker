// Web push from the bridge, with no library: the message is encrypted for one phone (RFC 8291, aes128gcm)
// and signed with the bridge's own key (VAPID, RFC 8292). Apple's push service delivers it to the
// Home Screen app on iPhone even when Round TUIT is closed.

const te = new TextEncoder();

export function b64uToBytes(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
export function bytesToB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts) {
  const all = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// The push services phones use. The bridge sends to nowhere else, so a made-up address cannot
// turn it into a way of reaching other servers.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushHost(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname)); } catch (e) { return false; }
}

// A subscription as the phone gives it: { endpoint, keys: { p256dh, auth } }. Returns a clean copy or null.
export function cleanSubscription(sub, hostOk) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  if (!(hostOk || isPushHost)(sub.endpoint)) return null;
  const k = sub.keys || {};
  try {
    if (b64uToBytes(k.p256dh).length !== 65 || b64uToBytes(k.auth).length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint: sub.endpoint, keys: { p256dh: String(k.p256dh), auth: String(k.auth) } };
}

// Encrypts text for one phone. opts (tests only): { local: an ECDH key pair, salt }.
export async function encryptPush(text, keys, opts) {
  const o = opts || {};
  const uaPublic = b64uToBytes(keys.p256dh), authSecret = b64uToBytes(keys.auth);
  const local = o.local || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hmac(await hmac(authSecret, shared), concat(te.encode('WebPush: info\0'), uaPublic, asPublic, [1]));
  const salt = o.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(te.encode(text), [2])));
  const head = new Uint8Array(86);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  head.set(asPublic, 21);
  return concat(head, body);
}

// The bridge's push key pair. Made once, on first use, and kept where only the bridge can read it,
// so nobody has to make or paste a key by hand.
let cached = null;
export async function vapidKeys(fs) {
  if (cached) return cached;
  const have = await fs.get('config/vapid');
  if (have) {
    const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(have.data.privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    cached = { publicKey: have.data.publicKey, privateKey };
    return cached;
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = bytesToB64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  if (!(await fs.commit([{ path: 'config/vapid', data: { publicKey, privateJwk }, mustBeNew: true }]))) return vapidKeys(fs); // made by another run first
  cached = { publicKey, privateKey: pair.privateKey };
  return cached;
}
export function forgetVapidKeys() { cached = null; }

export async function vapidHeader(endpoint, vapid, subject, now) {
  const head = bytesToB64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, te.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + bytesToB64u(sig) + ', k=' + vapid.publicKey;
}

// Sends one message. Returns 'sent', 'gone' (the phone no longer has this subscription) or 'failed'.
export async function sendPush(sub, message, vapid, opts) {
  const o = opts || {};
  if (!(o.hostOk || isPushHost)(sub.endpoint)) return 'gone';
  const body = await encryptPush(JSON.stringify(message), sub.keys);
  let r;
  try {
    r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid, o.subject, o.now || Date.now()),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(o.ttl || 900), Urgency: 'high',
      },
      body,
    });
  } catch (e) { return 'failed'; }
  if (r.status === 404 || r.status === 410) return 'gone';
  return r.ok ? 'sent' : 'failed';
}
