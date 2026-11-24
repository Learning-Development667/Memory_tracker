# Daybook: where the AI key lives and how the app calls it

Notes from Daybook (v487, 24 November 2026) for reuse in another app. File names refer to the `Mark_Medical` repository. The AI feature is called Daybook Assistant in the app.

## The short version

- **The key never touches the app or the repository.** It is a Cloudflare Worker secret on the bridge.
- **The app never calls the AI directly.** It calls the bridge's `/explain` route with the person's Firebase sign-in token; the bridge checks who they are, checks the limits, calls the Anthropic Messages API with the key, and sends back only the reply.
- **Nothing sent is stored.** Only counts and token totals are kept, for the limits and the bill.

## Where the key lives

| Step | Where | What |
| --- | --- | --- |
| 1 | Anthropic Console (console.anthropic.com) | Make an API key. Daybook runs on a prepaid credit. |
| 2 | GitHub, the repository's Settings, Secrets and variables, Actions | Save it as the repository secret `ANTHROPIC_API_KEY`. |
| 3 | `.github/workflows/deploy-worker.yml` | On every push that touches `worker/`, the workflow deploys the Worker and passes the secret to Cloudflare (step "Set the AI key", using `cloudflare/wrangler-action` with `secrets: ANTHROPIC_API_KEY`). |
| 4 | Cloudflare | The Worker reads it as `env.ANTHROPIC_API_KEY`. It is never printed or logged. |

Without the secret, `/explain` answers "not switched on yet" (HTTP 503) and the app offers its fallback instead (send the text to the person's own AI app through the phone's share sheet). The app must work fully without the AI.

The same pattern holds every other secret: the Firebase service account (`FIREBASE_SERVICE_ACCOUNT`), the email key (`RESEND_API_KEY`), the push key (`VAPID_PRIVATE_KEY`). They are listed at the top of `worker/wrangler.toml`. The deploy workflow also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## How the app calls it

From the app (`scripts.js`), the same `bridgeCall()` every bridge route uses:

```js
const data = await bridgeCall('/explain', {
  kind: 'document',            // which job: document, report, mood, pain, medicine, label, results...
  title: 'Clinic letter',
  text: '...the words...',     // and/or
  pages: [/* base64 JPEG page photos */]
});
// data = { text, model, usage: { input, output }, cut }
```

`bridgeCall()` adds `Authorization: Bearer <Firebase ID token>` from `auth.currentUser.getIdToken()`.

## What the bridge does (`handleExplain()` in `worker/src/index.js`)

1. **Key present?** If not, 503 "not switched on yet".
2. **Who is it?** Verifies the Firebase ID token (see the sign-in notes), reads `users/{uid}` and the members record. Only `family` members may use it.
3. **Clean the input.** `kind` must be one of a fixed list; text is cut to `EXPLAIN_MAX_TEXT_CHARS`; at most `EXPLAIN_MAX_PAGES` page photos, each within a size limit.
4. **Limits, counted before the call** so several taps at once cannot slip past (counts kept in `households/{hid}/bridge/explainLog` and `bridge/global`, bumped with server-side increments):

   | Limit | Daybook's value | Why |
   | --- | --- | --- |
   | Per circle per day | 40 (`EXPLAIN_LIMIT_REAL`) | A bug or a stuck finger cannot drain the credit |
   | Per circle per month | 60 (`EXPLAIN_LIMIT_MONTH`) | A budget. Report summaries for a clinician are never refused by the month (`EXPLAIN_REPORT_KINDS`) |
   | Whole app per day | 600 (`EXPLAIN_LIMIT_ALL`) | One credit pot for everyone |
   | Public demo per day | 12 (`EXPLAIN_LIMIT_DEMO`) | The demo sign-in is public |

5. **One call to the Messages API** over plain `fetch`, no SDK:

   ```js
   const body = { model: EXPLAIN_MODEL, max_tokens: EXPLAIN_MAX_TOKENS, system, messages: [{ role: 'user', content }] };
   const r = await fetch('https://api.anthropic.com/v1/messages', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
     body: JSON.stringify(body)
   });
   ```

   - `content` is the page photos as `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }` followed by one text block.
   - `system` is a fixed prompt per `kind` (`EXPLAIN_SYSTEM`). The facts-only rule lives in these prompts.
   - The model is one constant, `EXPLAIN_MODEL`; `EXPLAIN_MAX_TOKENS` is 4,000, which is also the cost cap per call.
   - The call first asks for Anthropic's server-side fallback (the `anthropic-beta: server-side-fallback-2026-07-01` header with `fallbacks: 'default'`). If the account refuses that with a 400 mentioning "fallback", it sends the plain request again.
6. **Errors in plain words.** If the call fails, the day's count is given back (bumped down by one) and the person gets a sentence they can act on (`aiErrorMessage()`): busy, too large, limit reached, or "the AI key was not accepted" for the operator when Anthropic returns 401. A refusal (`stop_reason: 'refusal'`) gets its own message.
7. **Reply.** Returns `{ text, model, usage, cut }` (`cut` is true when it stopped at `max_tokens`). Stores the token totals for the operator's Usage page; never the text.

## Things worth copying

- Keep every AI button's one-line disclosure in the app, and name the provider once on the privacy page.
- Count before the call, give the count back on failure.
- A whole-app daily ceiling as well as per-person limits.
- A fallback route that needs no key, so the feature is never a dead end.
- The Worker's allowed-origins list must include the native apps' origins (`capacitor://localhost` for iPhone, `https://localhost` for Android), or calls from the phone apps fail.

## To set it up in a new app

1. Anthropic Console: make a key, add credit, set a monthly spend limit there too.
2. Add `ANTHROPIC_API_KEY` as a GitHub repository secret.
3. Add a "Set the AI key" step to the Worker's deploy workflow (copy the one in `deploy-worker.yml`).
4. Copy `handleExplain()`, `askClaude()`, `claudeError()`, `aiErrorMessage()` and the limit constants; write your own system prompts per job.
5. Push a change under `worker/`, then check the deploy run in the Actions tab.
