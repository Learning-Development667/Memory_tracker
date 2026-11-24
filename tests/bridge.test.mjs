// The bridge must refuse every sign-in token it cannot prove came from Google for this project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseToken } from '../worker/src/index.js';

const env = { FIREBASE_PROJECT_ID: 'round-tuit-test' };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = Object.assign(await crypto.subtle.exportKey('jwk', pair.publicKey), { kid: 'key-1', alg: 'RS256', use: 'sig' });

// Stand in for Google's key list.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => (String(url).includes('securetoken@system') ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(url));

const now = () => Math.floor(Date.now() / 1000);
const good = () => ({ aud: 'round-tuit-test', iss: 'https://securetoken.google.com/round-tuit-test', sub: 'user-1', email: 'a@example.com', iat: now() - 10, exp: now() + 3600, firebase: { sign_in_provider: 'password' } });
async function token(claims, opts) {
  const o = opts || {};
  const head = b64u(JSON.stringify(o.head || { alg: 'RS256', kid: 'key-1', typ: 'JWT' })), body = b64u(JSON.stringify(claims));
  const sig = o.noSig ? '' : b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (o.key || pair).privateKey, new TextEncoder().encode(head + '.' + body)));
  return head + '.' + body + '.' + sig;
}
const refused = (t) => assert.rejects(() => verifyFirebaseToken(t, env), (e) => e.status === 401);

test('a real token is accepted', async () => {
  assert.deepEqual(await verifyFirebaseToken(await token(good()), env), { uid: 'user-1', email: 'a@example.com' });
});
test('a token for another project is refused', async () => {
  await refused(await token(Object.assign(good(), { aud: 'someone-else' })));
  await refused(await token(Object.assign(good(), { iss: 'https://securetoken.google.com/someone-else' })));
});
test('an expired token is refused', async () => { await refused(await token(Object.assign(good(), { exp: now() - 1 }))); });
test('a token signed by someone else is refused', async () => { await refused(await token(good(), { key: other })); });
test('an unsigned token is refused', async () => {
  await refused(await token(good(), { head: { alg: 'none', kid: 'key-1' }, noSig: true }));
  await refused(await token(good(), { noSig: true }));
});
test('a changed token is refused', async () => {
  const t = (await token(good())).split('.');
  t[1] = b64u(JSON.stringify(Object.assign(good(), { sub: 'user-2' })));
  await refused(t.join('.'));
});
test('an unknown key, an anonymous sign-in and rubbish are refused', async () => {
  await refused(await token(good(), { head: { alg: 'RS256', kid: 'key-9' } }));
  await refused(await token(Object.assign(good(), { firebase: { sign_in_provider: 'anonymous' } })));
  await refused(await token(Object.assign(good(), { sub: '' })));
  await refused('not.a.token'); await refused(''); await refused(undefined);
});
