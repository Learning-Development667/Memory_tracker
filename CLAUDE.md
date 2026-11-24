# Round TUIT

A shared jobs list for two people, built as a vanilla HTML, CSS and JS Home Screen web app in the Daybook look. Read `docs/PROJECT-BRIEF.md` before any build work.

- Every screen must work on the iPhone Duo: follow docs/IPHONE-DUO.md.
- Speech to text works: follow docs/SPEECH-TO-TEXT.md.
- Words: UK English, no em dashes, short plain sentences. Body text never under 17 px. Tap targets 48 px. Nothing relies on colour alone.
- No chips or pill buttons for choosing values. Use the sliders and plain rows already in the app.
- No real names or personal details in the code or tests: this repository is public.
- Tests: `npm test` (ordering and sentence reading), `node tests/sweep.mjs` (every width from the Duo guide).
