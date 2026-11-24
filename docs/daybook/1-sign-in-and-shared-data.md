# Daybook: how sign-in and shared data work

Notes from Daybook (v487, 24 November 2026) for reuse in another app. File names refer to the `Mark_Medical` repository.

## The pieces

| Piece | What it is | Where |
| --- | --- | --- |
| Firebase Authentication | Email and password sign-in. Nothing else (no Google, no anonymous). | Firebase console, project settings |
| Cloud Firestore | The database. Every person's data sits in one shared folder per care circle. | `firestore.rules` guards it |
| The app | Plain HTML, CSS and JavaScript, Firebase JS SDK v10 loaded from gstatic. Reads and writes Firestore directly. | `index.html`, `scripts.js`, `config.js` |
| The bridge | One Cloudflare Worker (free plan). Holds every secret, does anything the app must not do itself. | `worker/src/index.js`, `worker/wrangler.toml` |

The rule that makes it safe: **the app never writes who belongs where.** Membership is written only by the bridge, using a Firebase service account that bypasses the rules. The rules then trust those membership records.

## Configuration

`config.js` holds only the public Firebase web config (`window.DAYBOOK_CONFIG.firebase`: apiKey, authDomain, projectId and so on) and the bridge address (`window.DAYBOOK_BRIDGE.url`). The Firebase web config is public by design: access is controlled by Auth plus the rules, not by hiding it. No email address, password or key goes in the app or the repository (the repository is public).

## Signing in

- `initializeApp(CONFIG.firebase)`, `getAuth(app)`, then `setPersistence(auth, browserLocalPersistence)` so the sign-in survives closing the app.
- Firestore starts with an offline cache: `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`.
- `onAuthStateChanged(auth, enterApp)` drives everything: signed out shows the sign-in screen; signed in reads the person's pointer record and opens their circle.
- Email confirmation: the bridge sends its own branded email through Resend (`POST /verify-email`); if that is not set up, the app falls back to Firebase's `sendEmailVerification()`. Some bridge features (company access, sending reports) only accept a confirmed email (`email_verified` in the token).

## Where the data lives

```
users/{uid}                     { household, circles[] }   pointer: which circle this sign-in is using
households/{hid}                the circle record (owner, consent, packs)
households/{hid}/members/{uid}  { name, role, relation }   who belongs, and what they may do
households/{hid}/entries/...    everything logged
households/{hid}/medicines/...  and the same for profile, days, meals, documents, recordings, reminders...
```

- `users/{uid}.household` is the circle in use. `users/{uid}.circles` lists every circle one sign-in belongs to, so a carer can switch between two people with one email.
- The app reaches data only through two helpers, so nothing can forget the circle prefix:

```js
function hcol(name, ...rest) { return collection(db, 'households', state.household, name, ...rest); }
function hdoc(name, ...rest) { return doc(db, 'households', state.household, name, ...rest); }
```

## Roles

| Role | Can do |
| --- | --- |
| `family` | Read and write everything in the circle |
| `readonly` | Read everything, write nothing |
| `viewer` | Read a narrow slice only (medicines, treatment calendar, some charts) |

`relation` is separate: `patient`, `carer` or empty. It changes wording and who may invite, not database access. Only the patient, or whoever set the circle up, may invite or remove people; the circle can be handed over.

## The rules (`firestore.rules`)

The core of it:

```
function signedIn() { return request.auth != null; }
function memberPath(hid) {
  return /databases/$(database)/documents/households/$(hid)/members/$(request.auth.uid);
}
function isMember(hid)  { return signedIn() && exists(memberPath(hid)); }
function role(hid)      { return get(memberPath(hid)).data.role; }
function hasRole(hid, roles) { return isMember(hid) && role(hid) in roles; }
function isFamily(hid)  { return hasRole(hid, ['family']); }
function canRead(hid)   { return hasRole(hid, ['family', 'readonly']); }

match /users/{uid} {
  allow read: if signedIn() && request.auth.uid == uid;
  allow write: if false;            // only the bridge writes pointers
}
```

Then each collection under `households/{hid}` allows read with `canRead(hid)` and write with `isFamily(hid)`; `members` and the circle record are `allow write: if false` (the bridge writes them). Extra guards worth copying: size limits on large documents (under 900 KB, Firestore's hard limit is 1 MiB), and a check that a check-in can only be changed by the person who wrote it (`uid` stamped on the record).

Rules are not live until published (the "Publish database rules" workflow, or paste into Firestore, Rules). `tests/rules/` is a break-in test suite run on the Firestore emulator on every push that touches the rules: a stranger, another circle, a read-only writer, a viewer reaching for the wrong data, anyone writing a members record. Every case must be refused.

## How a circle is made and joined (all through the bridge)

1. **Sign-up.** The app asks patient or carer first, then calls `createUserWithEmailAndPassword()`.
2. **Make the circle.** The app calls `POST /household { name, relation, ... }` on the bridge. The bridge checks the token, makes `households/{hid}`, writes `members/{uid}` with role `family`, writes `users/{uid}`, and records consent (who, when, the exact words, the version).
3. **Invite.** The patient or owner calls `POST /invite { name, role, relation }`. The bridge makes a one-use code that expires in 7 days; the app shares it as a link with `?invite=CODE`.
4. **Join.** The new person signs up, then the app calls `POST /join { code }`. The bridge checks the code and writes their member and pointer records.
5. **Remove, hand over, delete:** `/member-remove`, `/owner-transfer`, `/circle-delete`, `/account-delete`, all on the bridge.

## How the app calls the bridge

Every call sends the person's Firebase ID token; the bridge never trusts anything else about who is calling.

```js
async function bridgeCall(path, payload) {
  const user = auth.currentUser;
  if (!BRIDGE || !user) throw new Error('Sign in first');
  const idToken = await user.getIdToken();
  const r = await fetch(BRIDGE.url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error((data && data.message) || 'Try again in a moment.');
  return data;
}
```

The bridge (`whoIs()` and `verifyFirebaseToken()` in `worker/src/index.js`) checks the token itself with no SDK:

- RS256 signature against Google's published keys (cached, refetched at most once a minute for an unknown key id);
- `aud` is the Firebase project id and `iss` is `https://securetoken.google.com/<project>`;
- not expired, `sub` (the uid) present, never an anonymous sign-in;
- then reads `users/{uid}` and `households/{hid}/members/{uid}` with the service account to learn the circle and role.

The bridge only answers the app's own addresses (`ALLOWED_ORIGINS`: the web addresses, plus `capacitor://localhost` for the iPhone app and `https://localhost` for Android).

## To copy this for a new app

1. A Firebase project: Authentication with Email/Password on; Firestore.
2. A service account key (Firebase, Project settings, Service accounts) saved as a GitHub secret, deployed to the Worker as a secret.
3. The pointer and folder shape above, and rules that trust only bridge-written membership records.
4. A Worker with `/household`, `/invite`, `/join` that verifies the ID token before doing anything.
5. The break-in tests before any real data goes in.
