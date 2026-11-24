// Two phones sharing one list, for real, against Firebase's local emulator. Also the break-in tests:
// a stranger, and a member reaching for what only the bridge may write. Every one must be refused.
//
// Run from the repository root (needs Java and the firebase-tools package):
//   npx firebase-tools emulators:exec --only auth,firestore --project demo-round-tuit "node tests/sharing.mjs"
//
// The bridge runs here in Node with a stand-in for Google's token check, because the emulator's
// sign-in tokens are unsigned. The real check is tested in tests/bridge.test.mjs.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBridge, makeScheduler, Refused } from '../worker/src/index.js';
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PROJECT = 'demo-round-tuit';
const AUTH = 'http://127.0.0.1:9099', STORE = 'http://127.0.0.1:8080';
const DOCS = STORE + '/v1/projects/' + PROJECT + '/databases/(default)/documents';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + server.address().port)));

/* The bridge, with the emulator standing in for Google. */
const bridge = makeBridge({
  verify: async (token) => {
    const claims = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString() || '{}');
    if (claims.aud !== PROJECT || !claims.sub) throw new Refused(401, 'Sign in again.');
    return { uid: claims.sub, email: claims.email || '' };
  },
  database: () => ({ root: DOCS, name: 'projects/' + PROJECT + '/databases/(default)/documents', headers: async () => ({ Authorization: 'Bearer owner' }) }),
  pushHostOk: (url) => String(url).startsWith('http://127.0.0.1:'), // the stand-in push service below
});
let site = '';
const bridgeServer = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request('http://bridge' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const out = await bridge(request, { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: site });
  res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer()));
});
const bridgeUrl = await listen(bridgeServer);

/* A stand-in for Apple's push service: keeps what it is sent. */
const pushed = [];
let pushReply = 201;
const pushServer = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  pushed.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(pushReply); res.end();
});
const pushUrl = await listen(pushServer);

/* The app, with config.js pointed at the emulator. */
const siteServer = createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    if (path === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end('window.ROUND_TUIT_CONFIG = ' + JSON.stringify({
        firebase: { apiKey: 'demo-key', authDomain: PROJECT + '.firebaseapp.com', projectId: PROJECT, appId: 'demo' },
        bridge: bridgeUrl, emulator: { auth: AUTH, firestoreHost: '127.0.0.1', firestorePort: 8080 },
      }) + ';');
      return;
    }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('outside');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
site = await listen(siteServer);

const browser = await chromium.launch();
async function phone(me, them) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(me + "'s phone, page error: " + e.message));
  await page.goto(site + '/');
  await page.fill('#wMe', me); await page.fill('#wThem', them);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const p = {
    page, context,
    add: async (text) => { await page.click('#addBtn'); await page.fill('#jt', text); await page.getByRole('button', { name: 'Save job' }).click(); },
    tab: async (name) => { await page.locator('#lists button', { hasText: name }).click(); },
    jobs: () => page.locator('.band .jt').allTextContents(),
    has: (title) => page.waitForFunction((t) => [...document.querySelectorAll('.band .jt')].some((e) => e.textContent === t), title, { timeout: 8000 }).then(() => true, () => false),
    gone: (title) => page.waitForFunction((t) => ![...document.querySelectorAll('.band .jt')].some((e) => e.textContent === t), title, { timeout: 8000 }).then(() => true, () => false),
    account: async (email) => {
      await page.click('#settingsBtn');
      await page.fill('#shEmail', email); await page.fill('#shPass', 'correct horse battery');
      await page.getByRole('button', { name: 'Create an account' }).click();
      await page.getByRole('button', { name: 'Start a shared list from this phone' }).waitFor({ timeout: 10000 });
    },
    close: async () => { if (await page.locator('dialog.sheet[open]').count()) await page.click('.sheethead .iconbtn'); },
  };
  return p;
}

try {
  /* ---------- 1. Two phones ---------- */
  const a = await phone('Alex', 'Sam');
  await a.add('Tidy the snug');
  await a.add('Post the parcel for Sam');
  await a.account('alex@example.com');
  await a.page.getByRole('button', { name: 'Start a shared list from this phone' }).click();
  await a.page.getByRole('button', { name: 'Make a code for the other phone' }).click();
  await a.page.locator('.sharebox .code').waitFor({ timeout: 10000 });
  const code = (await a.page.locator('.sharebox .code').textContent()).trim();
  expect(/^[A-Z2-9]{8}$/.test(code), 'the invite code was not 8 clear letters and numbers: ' + code);
  await a.close();

  const b = await phone('Sam', 'Alex');
  await b.add('Feed the cat');
  await b.account('sam@example.com');
  await b.page.fill('#shCode', code.toLowerCase());
  await b.page.getByRole('button', { name: 'Join with this code' }).click();
  await b.page.getByText('Sharing with').waitFor({ timeout: 10000 });
  expect((await b.page.locator('.sharebox').textContent()).includes('Sharing with Alex'), 'the second phone does not say who it shares with');
  await b.close();

  // The second phone keeps its own job, and receives the job the first phone put on its list.
  expect(await b.has('Feed the cat'), "the second phone's own job left its list on joining");
  expect(await b.has('Post the parcel'), "a job added for the other person did not reach their phone");
  expect(!(await b.jobs()).includes('Tidy the snug'), "the first phone's own job showed on the second phone's list");
  const meta = await b.page.locator('.job', { hasText: 'Post the parcel' }).locator('.meta').textContent();
  expect(meta.includes('From Alex'), 'the job does not say who added it: ' + meta);
  await b.tab("Alex's");
  expect(await b.has('Tidy the snug'), "the first phone's list does not show on the second phone");
  await b.tab('Mine');

  // The first phone sees the second phone's jobs under its name.
  await a.tab("Sam's");
  expect(await a.has('Feed the cat') && await a.has('Post the parcel'), "the second phone's jobs do not show on the first phone");

  // Ticking on one phone clears it on the other.
  await b.page.getByRole('button', { name: 'Done: Post the parcel' }).click();
  expect(await a.gone('Post the parcel'), 'a job ticked on one phone stayed on the other');

  // Adding, changing and removing travel both ways.
  await a.add('Take the parcel back, for either of us');
  await b.tab('Either of us');
  expect(await b.has('Take the parcel back'), 'a job for either of us did not reach the other phone');
  await b.page.locator('.jobbody', { hasText: 'Take the parcel back' }).click();
  await b.page.fill('#jt', 'Take the big parcel back');
  await b.page.getByRole('button', { name: 'Save changes' }).click();
  await a.tab('Either of us');
  expect(await a.has('Take the big parcel back'), 'a changed job did not change on the other phone');
  await a.page.locator('.jobbody', { hasText: 'Take the big parcel back' }).click();
  await a.page.getByRole('button', { name: 'Delete this job' }).click();
  await a.page.getByRole('button', { name: 'Tap again to delete' }).click();
  expect(await b.gone('Take the big parcel back'), 'a job removed on one phone stayed on the other');

  // Colours named on both phones are joined by name, not doubled.
  await b.page.click('#settingsBtn');
  expect(await b.page.locator('.colourrow').count() === 4, 'colours were doubled or lost on joining: ' + await b.page.locator('.colourrow').count());
  await b.close();

  // Closing and opening again: still signed in, list still there.
  await b.page.reload();
  await b.tab('Mine');
  expect(await b.has('Feed the cat'), 'the list was lost on opening the app again');
  await b.page.click('#settingsBtn');
  await b.page.getByText('Sharing with').waitFor({ timeout: 10000 }).catch(() => problems.push('the second phone was signed out by opening the app again'));
  await b.close();

  // A job removed while the other phone was closed must not come back when it opens.
  await b.context.close();
  await a.tab("Sam's");
  await a.page.locator('.jobbody', { hasText: 'Feed the cat' }).click();
  await a.page.getByRole('button', { name: 'Delete this job' }).click();
  await a.page.getByRole('button', { name: 'Tap again to delete' }).click();
  await a.gone('Feed the cat');

  // A third person with the same code is refused: it works once, and the list holds two.
  const c = await phone('Kit', 'Alex');
  await c.account('kit@example.com');
  await c.page.fill('#shCode', code);
  await c.page.getByRole('button', { name: 'Join with this code' }).click();
  await c.page.locator('.toast', { hasText: 'not right' }).waitFor({ timeout: 8000 }).catch(() => problems.push('a used code was not refused'));
  expect(await c.page.getByText('Sharing with').count() === 0, 'a third person got on to the list');

  /* ---------- 2. Break-in tests, straight at the database ---------- */
  const signIn = async (email) => {
    const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', returnSecureToken: true }) });
    return r.json();
  };
  const alex = await signIn('alex@example.com'), kit = await signIn('kit@example.com');
  const owner = { Authorization: 'Bearer owner' };
  const pointer = await (await fetch(DOCS + '/users/' + alex.localId, { headers: owner })).json();
  const cid = pointer.fields.circle.stringValue;
  const as = (who) => ({ Authorization: 'Bearer ' + who.idToken, 'content-type': 'application/json' });
  const task = (over) => ({ fields: Object.assign({ id: { stringValue: 'breakin1' }, title: { stringValue: 'x' }, list: { stringValue: 'a' }, addedBy: { stringValue: 'a' }, size: { integerValue: '5' }, due: { nullValue: null }, steps: { arrayValue: {} } }, over) });
  const tryIt = async (what, wantOk, method, path, who, body) => {
    const r = await fetch(DOCS + path, { method, headers: who ? as(who) : {}, body: body ? JSON.stringify(body) : undefined });
    expect(r.ok === wantOk, what + ' (' + r.status + ')');
  };
  const C = '/circles/' + cid;
  await tryIt('a member could not read the jobs', true, 'GET', C + '/tasks', alex);
  await tryIt('a member could not write a job', true, 'PATCH', C + '/tasks/breakin1', alex, task());
  await tryIt('a stranger read the jobs', false, 'GET', C + '/tasks', kit);
  await tryIt('someone not signed in read the jobs', false, 'GET', C + '/tasks', null);
  await tryIt('a stranger wrote a job', false, 'PATCH', C + '/tasks/breakin2', kit, task({ id: { stringValue: 'breakin2' } }));
  await tryIt('a stranger removed a job', false, 'DELETE', C + '/tasks/breakin1', kit);
  await tryIt('a stranger read who is on the list', false, 'GET', C + '/members', kit);
  await tryIt('a stranger read the colours', false, 'GET', C + '/meta/labels', kit);
  await tryIt('a stranger added themselves to the list', false, 'PATCH', C + '/members/' + kit.localId, kit, { fields: { name: { stringValue: 'Kit' }, seat: { stringValue: 'b' } } });
  await tryIt('a stranger pointed their sign-in at the list', false, 'PATCH', '/users/' + kit.localId, kit, { fields: { circle: { stringValue: cid } } });
  await tryIt('a member changed who is on the list', false, 'PATCH', C + '/members/' + alex.localId, alex, { fields: { name: { stringValue: 'Alex' }, seat: { stringValue: 'b' } } });
  await tryIt('a member changed the list record', false, 'PATCH', C, alex, { fields: { owner: { stringValue: kit.localId } } });
  await tryIt('a member moved their own sign-in', false, 'PATCH', '/users/' + alex.localId, alex, { fields: { circle: { stringValue: 'elsewhere' } } });
  await tryIt("a member read someone else's pointer", false, 'GET', '/users/' + kit.localId, alex);
  await tryIt('a member read the invite codes', false, 'GET', '/invites/' + code, alex);
  await tryIt('a member wrote an invite code', false, 'PATCH', '/invites/AAAAAAAA', alex, { fields: { circle: { stringValue: cid } } });
  await tryIt('a job on a list that does not exist was accepted', false, 'PATCH', C + '/tasks/breakin1', alex, task({ list: { stringValue: 'c' } }));
  await tryIt('a job with no title was accepted', false, 'PATCH', C + '/tasks/breakin1', alex, task({ title: { stringValue: '' } }));
  await tryIt('a job filed under another id was accepted', false, 'PATCH', C + '/tasks/breakin3', alex, task());
  await tryIt('a huge title was accepted', false, 'PATCH', C + '/tasks/breakin1', alex, task({ title: { stringValue: 'x'.repeat(301) } }));
  await tryIt('a member could not remove a job', true, 'DELETE', C + '/tasks/breakin1', alex);
  await tryIt('a member read the push key', false, 'GET', '/config/vapid', alex);
  await tryIt('a member wrote a push address', false, 'PATCH', C + '/push/' + alex.localId, alex, { fields: { sub: { stringValue: 'x' } } });
  await tryIt('a member read what reminders were sent', false, 'GET', C + '/bridge/sent', alex);

  /* ---------- 3. The bridge refuses what it should ---------- */
  const call = async (path, who, body, origin) => fetch(bridgeUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin || site, Authorization: 'Bearer ' + (who ? who.idToken : '') }, body: JSON.stringify(body || {}) });
  expect((await call('/invite', alex)).status === 409, 'the bridge made a code for a list that is already full');
  expect((await call('/invite', kit)).status === 403, 'the bridge made a code for someone on no list');
  expect((await call('/join', kit, { code: 'ZZZZZZZZ', name: 'Kit' })).status === 404, 'the bridge accepted a made-up code');
  expect((await call('/circle', null, { name: 'Nobody' })).status === 401, 'the bridge answered someone not signed in');
  expect((await call('/circle', kit, { name: 'Kit' }, 'https://elsewhere.example')).status === 403, 'the bridge answered another website');
  expect((await call('/join', alex, { code, name: 'Alex' })).status === 409, 'the bridge let someone on a list join another');
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('/join', kit, { code: 'YYYYYYY' + 'ABCDEFGHJKMN'[i], name: 'Kit' })).status;
  expect(last === 429, 'the bridge did not stop repeated guesses at a code (' + last + ')');

  /* ---------- 4. Reminders with the app closed ---------- */
  // Alex's phone subscribes. The bridge must accept only real push services: the stand-in is let through by the test.
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const authSecret = randomBytes(16);
  const subscription = { endpoint: pushUrl + '/alex', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
  const keyReply = await (await call('/push-key', alex)).json();
  expect(/^[A-Za-z0-9_-]{87}$/.test(keyReply.key || ''), 'the bridge did not give its push key');
  expect((await call('/push', alex, { subscription: { endpoint: 'https://evil.example/x', keys: subscription.keys } })).status === 400, 'the bridge accepted a push address that is not a push service');
  expect((await call('/push-key', kit)).status === 403, 'the bridge gave its push key to someone on no list');
  expect((await call('/push', alex, { subscription, quiet: { on: false, from: '22:00', to: '07:00' }, tz: 'Europe/London' })).ok, 'the bridge refused a good subscription');

  // A Buzzer job saved from Alex's phone, and a job for Sam that must not reach Alex.
  await a.tab('Mine');
  await a.page.click('#addBtn');
  await a.page.fill('#jt', 'Take the tablets within the hour');
  await a.page.locator('details.more > summary').click();
  await a.page.selectOption('#jRemind', 'buzzer');
  await a.page.getByRole('button', { name: 'Save job' }).click();
  await a.add('Post the letter within the hour, for Sam');
  const findTask = async (title) => {
    for (let i = 0; i < 40; i++) {
      const r = await (await fetch(DOCS + C + '/tasks?pageSize=100', { headers: owner })).json();
      const d = (r.documents || []).find((x) => x.fields.title.stringValue === title);
      if (d && d.fields.alarmAt && d.fields.alarmAt.integerValue) return { name: d.name, alarmAt: Number(d.fields.alarmAt.integerValue) };
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return null;
  };
  const tablets = await findTask('Take the tablets');
  expect(tablets, 'the job reached the shared list without a reminder time');
  if (tablets) {
    const env = { FIREBASE_PROJECT_ID: PROJECT };
    const at = (ms) => makeScheduler({ database: () => ({ root: DOCS, name: 'projects/' + PROJECT + '/databases/(default)/documents', headers: async () => ({ Authorization: 'Bearer owner' }) }), now: () => ms, pushHostOk: (u) => String(u).startsWith('http://127.0.0.1:') })(env);
    const T = tablets.alarmAt + 1000, MIN = 60000;
    const read = (m) => {
      const b = m.body, salt = b.subarray(0, 16), asPublic = b.subarray(21, 86);
      const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32));
      const d = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
      const data = b.subarray(86); d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString());
    };

    expect(await at(tablets.alarmAt - MIN) === 0, 'a reminder went before its time');
    pushed.length = 0;
    const sent1 = await at(T);
    expect(sent1 === 1 && pushed.length === 1, 'the due Buzzer job did not send exactly one message (' + sent1 + ', ' + pushed.length + ')');
    if (pushed[0]) {
      const m = read(pushed[0]);
      expect(m.title === 'Take the tablets' && m.kind === 'buzzer', 'the message did not name the job: ' + JSON.stringify(m));
      expect(String(pushed[0].headers.authorization || '').startsWith('vapid t='), 'the message was not signed');
      expect(pushed[0].headers['content-encoding'] === 'aes128gcm', 'the message was not encrypted');
    }
    pushed.length = 0;
    expect(await at(T + MIN) === 0, 'the buzzer repeated after one minute instead of two');
    expect(await at(T + 2 * MIN) === 1, 'the buzzer did not come back after two minutes');

    // Silence for 10 minutes, as the buzzer screen does.
    await fetch(DOCS.replace(/\/documents$/, '') + '/documents' + tablets.name.split('/documents')[1] + '?updateMask.fieldPaths=silencedUntil', { method: 'PATCH', headers: Object.assign({ 'content-type': 'application/json' }, owner), body: JSON.stringify({ fields: { silencedUntil: { integerValue: String(T + 2 * MIN + 10 * MIN) } } }) });
    expect(await at(T + 6 * MIN) === 0, 'Silence did not pause the buzzer');
    expect(await at(T + 13 * MIN) === 1, 'the buzzer did not come back after Silence');

    // Ticked on the phone: no more messages.
    await a.page.getByRole('button', { name: 'Done: Take the tablets' }).click();
    let stopped = false;
    for (let i = 0; i < 40 && !stopped; i++) { stopped = (await at(T + 20 * MIN)) === 0; if (!stopped) await new Promise((r2) => setTimeout(r2, 250)); }
    expect(stopped, 'the buzzer kept going after the job was ticked');
    expect(pushed.every((m) => read(m).title === 'Take the tablets'), "a job on Sam's list was sent to Alex's phone");

    // A phone that has gone away: the push service says 410, and the bridge forgets it.
    await a.add('Ring the dentist within the hour');
    const dentist = await findTask('Ring the dentist');
    pushReply = 410;
    await at(dentist.alarmAt + 1000);
    pushReply = 201;
    const gone = await fetch(DOCS + C + '/push/' + alex.localId, { headers: owner });
    expect(gone.status === 404, 'a subscription the push service said was gone was kept');
  }
} catch (e) {
  problems.push('the test stopped: ' + (e.stack || e.message));
}

await browser.close(); bridgeServer.close(); siteServer.close(); pushServer.close();
if (problems.length) { console.log(problems.length + ' problems:\n' + problems.join('\n')); process.exit(1); }
console.log('Sharing works between two phones, every break-in was refused, and closed-app reminders arrive, repeat, pause and stop as they should.');
