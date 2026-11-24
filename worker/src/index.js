// Round TUIT bridge: one Cloudflare Worker. It alone writes who belongs to which shared list.
// The pattern is Daybook's (docs/daybook/1-sign-in-and-shared-data.md): the app sends the person's
// Firebase ID token with every call, the bridge checks it, and nothing else about the caller is trusted.
//
// Secret: FIREBASE_SERVICE_ACCOUNT (the service account's JSON key). Never printed or logged.
// Vars (wrangler.toml): FIREBASE_PROJECT_ID, ALLOWED_ORIGINS.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0, O, 1, I or L: easy to read out and type
const INVITE_DAYS = 7;
const JOIN_TRIES_A_DAY = 10;
const DAY = 86400000;

export class Refused extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- small tools ---------- */
const te = new TextEncoder(), td = new TextDecoder();
function b64uToBytes(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomCode(n) {
  // Throw away bytes that would favour some letters over others.
  const limit = 256 - (256 % CODE_LETTERS.length);
  let out = '';
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < limit && out.length < n) out += CODE_LETTERS[b % CODE_LETTERS.length];
    }
  }
  return out;
}
function randomId() { return bytesToB64u(crypto.getRandomValues(new Uint8Array(15))); }
function cleanName(v) {
  const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!s) throw new Refused(400, 'Add your first name.');
  return s;
}

/* ---------- who is calling ---------- */
let jwks = { keys: {}, at: 0 };
async function googleKey(kid) {
  const now = Date.now();
  // Fetched keys are kept for an hour; an unknown key id refetches at most once a minute.
  if (!jwks.keys[kid] ? now - jwks.at > 60000 : now - jwks.at > 3600000) {
    const r = await fetch(JWKS_URL);
    if (r.ok) {
      const keys = {};
      for (const k of (await r.json()).keys || []) keys[k.kid] = k;
      jwks = { keys, at: now };
    }
  }
  return jwks.keys[kid] || null;
}

// Checks a Firebase ID token with no SDK. Returns { uid, email } or throws Refused.
export async function verifyFirebaseToken(token, env) {
  const no = () => new Refused(401, 'Sign in again.');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw no();
  let head, claims;
  try { head = JSON.parse(td.decode(b64uToBytes(parts[0]))); claims = JSON.parse(td.decode(b64uToBytes(parts[1]))); } catch (e) { throw no(); }
  if (!head || head.alg !== 'RS256' || !head.kid) throw no();
  const jwk = await googleKey(head.kid);
  if (!jwk) throw no();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uToBytes(parts[2]), te.encode(parts[0] + '.' + parts[1]));
  if (!good) throw no();
  const now = Math.floor(Date.now() / 1000), project = env.FIREBASE_PROJECT_ID;
  if (!project || claims.aud !== project || claims.iss !== 'https://securetoken.google.com/' + project) throw no();
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw no();
  if (typeof claims.iat !== 'number' || claims.iat > now + 300) throw no();
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw no();
  if (claims.firebase && claims.firebase.sign_in_provider === 'anonymous') throw no();
  return { uid: claims.sub, email: claims.email || '' };
}

/* ---------- the database, as the service account ---------- */
let access = { token: '', until: 0 };
async function serviceToken(env) {
  if (access.token && Date.now() < access.until) return access.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const head = bytesToB64u(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = bytesToB64u(te.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: TOKEN_URL, iat: now, exp: now + 3600 })));
  const pem = String(sa.private_key).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = bytesToB64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(head + '.' + body)));
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + body + '.' + sig,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || !data.access_token) throw new Refused(503, 'Sharing is not switched on yet.');
  access = { token: data.access_token, until: Date.now() + (data.expires_in - 120) * 1000 };
  return access.token;
}

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
function encFields(o) { const f = {}; for (const k of Object.keys(o)) f[k] = enc(o[k]); return f; }
function dec(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
function decFields(f) { const o = {}; for (const k of Object.keys(f || {})) o[k] = dec(f[k]); return o; }

// deps.database(env) gives { root, name, headers() }. The real one talks to Firestore as the service account.
function realDatabase(env) {
  const name = 'projects/' + env.FIREBASE_PROJECT_ID + '/databases/(default)/documents';
  return { root: 'https://firestore.googleapis.com/v1/' + name, name, headers: async () => ({ Authorization: 'Bearer ' + await serviceToken(env) }) };
}
function store(dbi) {
  const call = async (method, url, body) => {
    const r = await fetch(url, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, await dbi.headers()), body: body ? JSON.stringify(body) : undefined });
    return r;
  };
  return {
    async get(path) {
      const r = await call('GET', dbi.root + '/' + path);
      if (r.status === 404) return null;
      if (!r.ok) throw new Refused(503, 'Try again in a moment.');
      const d = await r.json();
      return { data: decFields(d.fields), updateTime: d.updateTime };
    },
    async list(path) {
      const r = await call('GET', dbi.root + '/' + path + '?pageSize=20');
      if (!r.ok) throw new Refused(503, 'Try again in a moment.');
      return ((await r.json()).documents || []).map((d) => ({ id: d.name.split('/').pop(), data: decFields(d.fields) }));
    },
    // writes: [{ path, data, mustBeNew, ifUpdatedAt }] all or nothing. False if a condition failed.
    async commit(writes) {
      const body = { writes: writes.map((w) => {
        const out = { update: { name: dbi.name + '/' + w.path, fields: encFields(w.data) } };
        if (w.mustBeNew) out.currentDocument = { exists: false };
        else if (w.ifUpdatedAt) out.currentDocument = { updateTime: w.ifUpdatedAt };
        return out;
      }) };
      const r = await call('POST', dbi.root + ':commit', body);
      if (r.status === 409 || r.status === 400 || r.status === 412) return false;
      if (!r.ok) throw new Refused(503, 'Try again in a moment.');
      return true;
    },
  };
}

/* ---------- what the bridge does ---------- */
async function whereIs(fs, uid) {
  const pointer = await fs.get('users/' + uid);
  const circle = pointer && pointer.data.circle;
  if (!circle) return null;
  const member = await fs.get('circles/' + circle + '/members/' + uid);
  return member ? { circle, seat: member.data.seat, name: member.data.name } : null;
}

const routes = {
  // Start a shared list. The first phone takes place 'a'.
  async '/circle'(fs, who, body) {
    const name = cleanName(body.name);
    const have = await whereIs(fs, who.uid);
    if (have) return { circle: have.circle, seat: have.seat };
    const circle = randomId(), now = Date.now();
    const ok = await fs.commit([
      { path: 'users/' + who.uid, data: { circle }, mustBeNew: true },
      { path: 'circles/' + circle, data: { owner: who.uid, createdAt: now }, mustBeNew: true },
      { path: 'circles/' + circle + '/members/' + who.uid, data: { name, seat: 'a', joinedAt: now }, mustBeNew: true },
    ]);
    if (!ok) { // a second tap arrived while the first was being written
      const again = await whereIs(fs, who.uid);
      if (again) return { circle: again.circle, seat: again.seat };
      throw new Refused(409, 'Try again in a moment.');
    }
    return { circle, seat: 'a' };
  },

  // A one-use code for the other phone. It runs out after 7 days.
  async '/invite'(fs, who) {
    const have = await whereIs(fs, who.uid);
    if (!have) throw new Refused(403, 'Start sharing on this phone first.');
    const members = await fs.list('circles/' + have.circle + '/members');
    if (members.length >= 2) throw new Refused(409, 'Both places on this list are taken.');
    const expires = Date.now() + INVITE_DAYS * DAY;
    for (let i = 0; i < 4; i++) {
      const code = randomCode(8);
      if (await fs.commit([{ path: 'invites/' + code, data: { circle: have.circle, by: who.uid, expires, used: false }, mustBeNew: true }])) return { code, expires };
    }
    throw new Refused(503, 'Try again in a moment.');
  },

  // The second phone joins with the code and takes place 'b'.
  async '/join'(fs, who, body) {
    const name = cleanName(body.name);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const have = await whereIs(fs, who.uid);
    if (have) throw new Refused(409, 'This sign-in is already on a shared list.');
    if (code.length !== 8) throw new Refused(400, 'The code is 8 letters and numbers.');

    // A limit on wrong guesses, counted before the code is looked at.
    const day = new Date().toISOString().slice(0, 10), triesPath = 'joinTries/' + who.uid;
    const tries = await fs.get(triesPath);
    const n = tries && tries.data.day === day ? tries.data.n : 0;
    if (n >= JOIN_TRIES_A_DAY) throw new Refused(429, 'Too many tries today. Ask for a new code tomorrow.');
    await fs.commit([{ path: triesPath, data: { day, n: n + 1 } }]);

    const bad = new Refused(404, 'That code is not right, or it has been used or run out. Ask for a new one.');
    const invite = await fs.get('invites/' + code);
    if (!invite || invite.data.used || invite.data.expires < Date.now()) throw bad;
    const circle = invite.data.circle;
    const members = await fs.list('circles/' + circle + '/members');
    if (members.length >= 2) throw new Refused(409, 'Both places on this list are taken.');
    const ok = await fs.commit([
      { path: 'invites/' + code, data: Object.assign({}, invite.data, { used: true, usedBy: who.uid }), ifUpdatedAt: invite.updateTime },
      { path: 'users/' + who.uid, data: { circle }, mustBeNew: true },
      { path: 'circles/' + circle + '/members/' + who.uid, data: { name, seat: 'b', joinedAt: Date.now() }, mustBeNew: true },
    ]);
    if (!ok) throw bad;
    return { circle, seat: 'b' };
  },

  // Change the name the other phone sees.
  async '/name'(fs, who, body) {
    const name = cleanName(body.name);
    const have = await whereIs(fs, who.uid);
    if (!have) throw new Refused(403, 'Start sharing on this phone first.');
    const path = 'circles/' + have.circle + '/members/' + who.uid;
    const member = await fs.get(path);
    await fs.commit([{ path, data: Object.assign({}, member.data, { name }) }]);
    return { name };
  },
};

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' };
}

// deps lets the tests stand in for Google: { verify(token, env), database(env) }.
export function makeBridge(deps) {
  return async function handle(request, env) {
    const headers = cors(request, env);
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers || {}) });
    if (!headers) return reply(403, { message: 'Not allowed from here.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const route = routes[new URL(request.url).pathname];
    if (request.method !== 'POST' || !route) return reply(404, { message: 'Not found.' });
    try {
      if (!env.FIREBASE_PROJECT_ID || (deps.needsSecret && !env.FIREBASE_SERVICE_ACCOUNT)) throw new Refused(503, 'Sharing is not switched on yet.');
      const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
      const who = await deps.verify(bearer, env);
      const text = await request.text();
      if (text.length > 4000) throw new Refused(413, 'Too much was sent.');
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch (e) { throw new Refused(400, 'That could not be read.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Refused(400, 'That could not be read.');
      return reply(200, await route(store(deps.database(env)), who, body));
    } catch (e) {
      if (e instanceof Refused) return reply(e.status, { message: e.message });
      return reply(500, { message: 'Something went wrong. Try again in a moment.' }); // the cause is never sent back
    }
  };
}

export default { fetch: makeBridge({ verify: verifyFirebaseToken, database: realDatabase, needsSecret: true }) };
