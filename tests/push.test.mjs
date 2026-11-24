// Closed-app reminders: the encryption a phone can read, the signature Apple checks, and when each is sent.
// Decryption here uses Node's own crypto (a different route from the bridge's WebCrypto code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, hkdfSync, createPublicKey, verify, randomBytes } from 'node:crypto';
import { encryptPush, vapidHeader, isPushHost, cleanSubscription, bytesToB64u } from '../worker/src/push.js';
import { whatToSend } from '../worker/src/index.js';

// A phone's side of a subscription.
function phone() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
// RFC 8291 decryption, as the phone does it.
function decrypt(body, p) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen);
  const shared = p.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), p.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, p.auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idlen);
  assert.ok(data.length <= rs, 'one record');
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record padding delimiter');
  return plain.subarray(0, plain.length - 1).toString();
}

test('the phone can read the message', async () => {
  const p = phone();
  const msg = JSON.stringify({ title: 'Ring the plumber', body: 'Still to do.', id: 'abc' });
  const body = Buffer.from(await encryptPush(msg, p.keys));
  assert.equal(decrypt(body, p), msg);
});

test('another phone cannot read it', async () => {
  const p = phone(), q = phone();
  const body = Buffer.from(await encryptPush('secret job', p.keys));
  assert.throws(() => decrypt(body, Object.assign({}, q, { keys: p.keys })));
});

test('each message is encrypted afresh', async () => {
  const p = phone();
  const a = Buffer.from(await encryptPush('same', p.keys)), b = Buffer.from(await encryptPush('same', p.keys));
  assert.notDeepEqual(a, b);
});

test('the signature checks out with the public key, for the push service it is sent to', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = bytesToB64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const now = Date.now();
  const header = await vapidHeader('https://web.push.apple.com/QAbc123', { publicKey, privateKey: pair.privateKey }, 'https://example.com/', now);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, publicKey);
  const [h, b, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(b, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://example.com/');
  assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 3600 + 1);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const ok = verify('sha256', Buffer.from(h + '.' + b), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'ES256 signature');
});

test('the bridge only sends to real push services', () => {
  assert.ok(isPushHost('https://web.push.apple.com/QAbc'));
  assert.ok(isPushHost('https://fcm.googleapis.com/fcm/send/x'));
  for (const bad of ['http://web.push.apple.com/x', 'https://web.push.apple.com:8443/x', 'https://evil.example/x', 'https://web.push.apple.com.evil.example/x', 'https://169.254.169.254/', 'nonsense']) assert.ok(!isPushHost(bad), bad);
  const p = phone();
  assert.ok(cleanSubscription({ endpoint: 'https://web.push.apple.com/x', keys: p.keys }));
  assert.equal(cleanSubscription({ endpoint: 'https://evil.example/x', keys: p.keys }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'short', auth: p.keys.auth } }), null);
});

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 24, 14, 0); // 2 pm in London
const prefs = { quietOn: true, quietFrom: '22:00', quietTo: '07:00', tz: 'Europe/London' };
const night = Date.UTC(2026, 10, 24, 23, 0);
test('Quiet once, Nudge every 15 minutes, Buzzer every 2 minutes', () => {
  const t = (remind) => ({ remind, hasTime: true, alarmAt: NOW - MIN });
  assert.equal(whatToSend(t('quiet'), null, NOW, prefs), 'quiet');
  assert.equal(whatToSend(t('quiet'), { last: NOW - 60 * MIN }, NOW, prefs), null);
  assert.equal(whatToSend(t('nudge'), { last: NOW - 10 * MIN }, NOW, prefs), null);
  assert.equal(whatToSend(t('nudge'), { last: NOW - 15 * MIN }, NOW, prefs), 'nudge');
  assert.equal(whatToSend(t('buzzer'), { last: NOW - MIN }, NOW, prefs), null);
  assert.equal(whatToSend(t('buzzer'), { last: NOW - 2 * MIN + 3000 }, NOW, prefs), 'buzzer', 'a timer a few seconds early still counts');
});
test('Silence pauses the buzzer, then it comes back', () => {
  const t = { remind: 'buzzer', hasTime: true, silencedUntil: NOW + 5 * MIN };
  assert.equal(whatToSend(t, { last: NOW - 10 * MIN }, NOW, prefs), null);
  assert.equal(whatToSend(t, { last: NOW - 10 * MIN }, NOW + 6 * MIN, prefs), 'buzzer');
});
test('quiet hours follow the phone\'s time zone', () => {
  const nudge = { remind: 'nudge', hasTime: true };
  assert.equal(whatToSend(nudge, { last: night - 30 * MIN }, night, prefs), null, '11 pm in London is quiet');
  assert.equal(whatToSend(nudge, { last: night - 30 * MIN }, night, Object.assign({}, prefs, { tz: 'America/New_York' })), 'nudge', '6 pm in New York is not');
  assert.equal(whatToSend({ remind: 'buzzer', hasTime: false }, null, night, prefs), null, 'an all-day buzzer waits for morning');
  assert.equal(whatToSend({ remind: 'buzzer', hasTime: true }, null, night, prefs), 'buzzer', 'a buzzer set for a time still sounds');
});
