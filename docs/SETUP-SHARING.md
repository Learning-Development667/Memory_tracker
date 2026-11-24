# Switching on sharing between the two phones

Round TUIT works on one phone with nothing set up. Sharing needs three things that only the owner can make: a Firebase project, three GitHub secrets, and one run of a workflow. About 20 minutes. The pattern is Daybook's (`docs/daybook/`).

Until `config.js` is filled in, the app shows "Sharing is not switched on yet" and keeps working as before.

## Before you start: a separate Firebase project
Make a **new** Firebase project for Round TUIT. Do not reuse Daybook's. Daybook holds health records; a jobs list should not sit in the same database or behind the same rules. The Cloudflare account can be the same one: the bridge is a second, separate Worker.

## 1. Firebase (console.firebase.google.com)
1. Add project. Name it Round TUIT. Analytics off.
2. Build, Authentication, Get started. Sign-in method: turn on **Email/Password** only.
3. Authentication, Settings, Authorised domains: add `learning-development667.github.io`.
4. Build, Firestore Database, Create database. Production mode. Location: `europe-west2` (London).
5. Firestore, Rules: replace everything with the contents of `firestore.rules` from this repository, then **Publish**.
6. Project settings (the cog), General, Your apps: add a **Web app** (the `</>` button), call it Round TUIT. Copy the four values it shows: `apiKey`, `authDomain`, `projectId`, `appId`. These are public by design and safe to paste into a chat.
7. Project settings, Service accounts: **Generate new private key**. A JSON file downloads. This one is secret. It goes into GitHub only (step 2), never into a chat, an email or the repository.

## 2. GitHub secrets
In this repository: Settings, Secrets and variables, Actions, New repository secret.

| Secret | What to paste |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | The whole contents of the JSON file from step 1.7 |
| `CLOUDFLARE_API_TOKEN` | The same value Daybook's repository uses (or a new token from the "Edit Cloudflare Workers" template) |
| `CLOUDFLARE_ACCOUNT_ID` | The same value Daybook's repository uses |

Then delete the downloaded JSON file from the computer.

## 3. Fill in the two public settings files
Give Claude the four values from step 1.6, or edit by hand:
- `config.js`: `apiKey`, `authDomain`, `projectId`, `appId`.
- `worker/wrangler.toml`: `FIREBASE_PROJECT_ID` (the same `projectId`).

## 4. Deploy the bridge
Actions tab, **Deploy the bridge**, Run workflow. When it finishes, the log shows the Worker's address, like `https://round-tuit-bridge.<your-name>.workers.dev`. Put that address in `config.js` as `bridge` (or give it to Claude).

## 5. On the phones
Close and open Round TUIT on both phones so they pick up the new settings.
1. **First phone:** Settings, Sharing, Create an account, then **Start a shared list from this phone**, then **Make a code for the other phone**.
2. **Second phone:** Settings, Sharing, Create an account (its own email), type the code, **Join with this code**.

Jobs already on each phone go up to the shared list. The code works once and runs out after 7 days. The list holds two people.

## If something is wrong
| What you see | What to check |
| --- | --- |
| "Sharing is not switched on yet" | `config.js` still has an empty `apiKey` or `bridge`, or the phone has an old copy: close and open the app twice |
| "Not allowed from here" or sign-in works but Start does nothing | The app's address is not in `ALLOWED_ORIGINS` in `worker/wrangler.toml` |
| "Sign in again" on Start | `FIREBASE_PROJECT_ID` in `worker/wrangler.toml` does not match the project |
| "Sharing is not switched on yet" after Start | The `FIREBASE_SERVICE_ACCOUNT` secret is missing or not the whole JSON; run the workflow again after fixing it |
| "The shared list could not be read" | The rules were not published (step 1.5) |

## How it was tested
`tests/sharing.mjs` runs two browsers as two phones against Firebase's local emulator: sign up, start, invite, join, add for each other, tick, change, remove, reopen. It then tries 18 break-ins straight at the database (a stranger, someone signed out, a member reaching for membership records, badly formed jobs) and 7 at the bridge. Every one must be refused. `tests/bridge.test.mjs` checks that forged, expired, unsigned and wrong-project sign-in tokens are refused. None of this has run against the real Firebase or Cloudflare yet: the first real run is step 5.
