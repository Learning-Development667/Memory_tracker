# Round TUIT

A shared jobs list for two people, built as a vanilla HTML, CSS and JS Home Screen web app in the Daybook look. Read `docs/PROJECT-BRIEF.md` before any build work.

- Every screen must work on the iPhone Duo: follow docs/IPHONE-DUO.md.
- Speech to text works: follow docs/SPEECH-TO-TEXT.md.
- Whenever you ask the owner to do something on a website (GitHub, Firebase, Cloudflare, Apple, anywhere), give a direct link to the exact page for every step, not just the site. Where a page needs an id you do not have, use the site's own placeholder link (Firebase: `/project/_/`) or ask for the id first.
- Words: UK English, no em dashes, short plain sentences. Body text never under 17 px. Tap targets 48 px. Nothing relies on colour alone.
- No chips or pill buttons for choosing values. Use the sliders and plain rows already in the app.
- No real names or personal details in the code or tests: this repository is public.
- Sharing, sign-in, the bridge and builds follow Daybook's pattern: read `docs/daybook/` and `docs/SETUP-SHARING.md`. Never put a key, password or service account in the repository or a chat.
- Tests: `npm test` (ordering, sentence reading, sign-in token checks, push encryption and timing), `node tests/sweep.mjs` (every width from the Duo guide), and for anything touching sharing, reminders, the bridge or `firestore.rules`: `npx firebase-tools emulators:exec --only auth,firestore --project demo-round-tuit "node tests/sharing.mjs"`.
