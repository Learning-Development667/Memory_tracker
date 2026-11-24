# Speech to text (Tap to speak): how it works in a web app on iPhone and Android

For Claude Code in this repository. Save as `docs/SPEECH-TO-TEXT.md` and add to CLAUDE.md: "Speech to text works: follow docs/SPEECH-TO-TEXT.md."

**It works.** My Medical Daybook (vanilla HTML, CSS and JS, run in Safari, as a Home Screen PWA, and wrapped with Capacitor for TestFlight and Google Play) has had a working Tap to speak button under every note box since October 2026, used every day on iPhone, the iPhone Duo and Android. The source is `speakButton()` in `scripts.js` of the `Mark_Medical` repository. Do not tell the user it might not work; build it as below. If something fails, the button shows the phone's own error reason, so you can find out why rather than guess.

## What it uses
The browser's built-in Web Speech API: `window.SpeechRecognition || window.webkitSpeechRecognition`.
- iPhone (Safari, Home Screen app, and the Capacitor WKWebView): Apple's recogniser via Siri and Dictation, on the device where the phone supports it.
- Android (Chrome and the Capacitor WebView): Google's recogniser.
- No library, no server, no API key, no cost. Nothing of ours sits between the microphone and the words.

## The things that make it reliable (each one was a real bug first)
1. **Start only from a tap.** `rec.start()` must run inside a click handler, or iOS refuses it.
2. **Settings:** `lang = 'en-GB'`, `interimResults = true` (words appear as spoken), `continuous = true` on iPhone and `false` on Android (see 5).
3. **Keep listening until the person taps stop.** Phones end a session by themselves after a pause or a time limit, even with `continuous` on. That cut dictation off mid-sentence. In `onend`, if the person still wants it on, start a fresh session after 400 ms that **carries on from the words already in the box** (take `base = box.value.trim()` at each session start and write `base + ' ' + newText`). Stop for real only on a tap, a refused microphone, the page going to the background, or 4 sessions in a row that ended within 1.5 s having heard nothing.
4. **One recogniser for the whole app.** A phone has one. Starting a second aborts the first, and two buttons then fight forever ("aborted" errors, a microphone that never goes off). Keep a single module-level `speechLive` stop function; a new tap stops the old one first; anything that removes a box from the screen (closing a sheet, Next, Back) calls `stopSpeech()`. In `onresult`, if the box is no longer in the document, stop quietly.
5. **Android repeats words unless you handle it.** Android sends each growing version of a sentence as a separate result ("does", "does this", "does this push"), so joining them writes every word several times. On Android, listen one sentence per session (`continuous = false`, the restart in 3 carries on) and de-duplicate: a result that starts with the previous one replaces it; one the previous already starts with is skipped (`speechParts()` below).
6. **Write into the box and fire `input`.** `box.value = ...; box.dispatchEvent(new Event('input', { bubbles: true }));` so drafts, counters and validation see the words like typing. The words stay editable.
7. **Show what is happening on the button.** "Tap to speak" / "Listening, tap to stop" with `aria-pressed`. Show "(nothing heard yet)" until words arrive, and the phone's error code (for example "(not-allowed)") if one comes. After 6 seconds with nothing heard, show: "Not hearing anything yet. Check Settings, Siri, Dictation is on, or use the keyboard microphone."
8. **Errors:** `not-allowed` or `service-not-allowed` stop and say "Allow the microphone for this site to speak your notes". `no-speech` and `aborted` are normal; say nothing. Anything else: "Could not hear that. Try again, or type it."
9. **Keep the screen awake** while listening (`navigator.wakeLock.request('screen')`, renewed each session, released at the end), and stop when `document.hidden` becomes true.
10. **No support, no button.** If neither constructor exists, do not show the button at all. The keyboard's own microphone key still works in every text box, so there is always a way to speak.

## Native wrappers (Capacitor)
- **iPhone `Info.plist`** must have both, or the app is refused or crashes on first use:
  - `NSMicrophoneUsageDescription`: "Daybook uses the microphone for Tap to speak..."
  - `NSSpeechRecognitionUsageDescription`: "Daybook turns what you say into words in the box when you tap Tap to speak."
- **Android `AndroidManifest.xml`:** `<uses-permission android:name="android.permission.RECORD_AUDIO" />`.
- On the web, the page must be served over HTTPS (localhost is fine for testing).

## When it does not work on someone's phone (the real causes we have seen)
- iPhone: Settings, General, Keyboard, **Enable Dictation** is off, or Siri is restricted (Screen Time). That gives `service-not-allowed`.
- The microphone was refused once for the site or app: Settings, the app (or Safari, Microphone) to allow it again.
- Another app holds the microphone (a call, a voice recorder).
None of these is a code problem; the button's message tells the person what to check.

## The code (copy and adapt)
```js
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const IS_ANDROID_SPEECH = /Android/i.test(navigator.userAgent);
const SPEAK_RESTART_MS = 400, SPEAK_DEAD_MAX = 4;
let speechLive = null;
function stopSpeech() { if (speechLive) speechLive(); }

function speechParts(results) { // Android: keep the latest growth of each sentence once
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const t = String(results[i][0].transcript || '').trim();
    if (!t) continue;
    const prev = parts.length ? parts[parts.length - 1].toLowerCase() : null, low = t.toLowerCase();
    if (prev !== null && low.startsWith(prev)) parts[parts.length - 1] = t;
    else if (prev !== null && prev.startsWith(low)) continue;
    else parts.push(t);
  }
  return parts;
}

function speakButton(target) {           // target: a <textarea> or <input>
  if (!SpeechRec) return null;           // no support: no button
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'speakbtn'; btn.setAttribute('aria-pressed', 'false');
  btn.textContent = 'Tap to speak';
  let rec = null, want = false, dead = 0, wake = null, everHeard = false, lastErr = '', quietTimer = null;

  const setState = (on) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Listening, tap to stop' + (lastErr ? ' (' + lastErr + ')' : everHeard ? '' : ' (nothing heard yet)') : 'Tap to speak';
  };
  const keepAwake = async () => { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; if (want && !document.hidden) keepAwake(); }); } } catch (e) { wake = null; } };
  const letGo = () => { try { if (wake) wake.release(); } catch (e) {} wake = null; };
  const finish = (focus) => {
    want = false; rec = null; letGo(); clearTimeout(quietTimer); setState(false);
    document.removeEventListener('visibilitychange', onHide);
    if (speechLive === quietStop) speechLive = null;
    if (focus && target.isConnected) target.focus();
  };
  const quietStop = () => { const was = rec; rec = null; finish(false); try { if (was) was.abort(); } catch (e) {} };
  const onHide = () => { if (document.hidden && want) quietStop(); };

  const begin = () => {
    const base = target.value.trim();
    const join = (t) => (base ? base + ' ' : '') + t.trim();
    const r = new SpeechRec(); rec = r;
    const startedAt = Date.now(); let heard = false;
    r.lang = 'en-GB';
    r.interimResults = true;
    r.continuous = !IS_ANDROID_SPEECH;
    r.onstart = () => { if (rec !== r) return; lastErr = ''; setState(true); };
    r.onresult = (ev) => {
      if (rec !== r) return;
      if (!target.isConnected) { quietStop(); return; }
      let text = '';
      if (IS_ANDROID_SPEECH) text = speechParts(ev.results).join(' ');
      else for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript + (ev.results[i].isFinal ? ' ' : '');
      if (text.trim()) { heard = true; dead = 0; everHeard = true; lastErr = ''; setState(true); }
      target.value = join(text);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    };
    r.onerror = (ev) => {
      if (rec !== r) return;
      if (ev.error !== 'no-speech') { lastErr = ev.error || 'error'; if (want) setState(true); }
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { want = false; toast('Allow the microphone for this site to speak your notes'); }
      else if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Could not hear that. Try again, or type it.');
    };
    r.onend = () => {
      if (rec !== r) return;
      if (!want) { finish(true); return; }
      if (!heard && Date.now() - startedAt < 1500) dead++;
      if (dead >= SPEAK_DEAD_MAX) { toast('Listening stopped. Tap to speak again, or use the keyboard microphone.'); finish(true); return; }
      rec = null;
      setTimeout(() => {
        if (!want) { finish(true); return; }
        if (!target.isConnected) { quietStop(); return; }
        try { begin(); } catch (e) { finish(true); toast('Listening stopped. Tap to speak again.'); }
      }, SPEAK_RESTART_MS);
    };
    r.start();
    keepAwake();
  };

  btn.addEventListener('click', () => {
    if (want || rec) { const was = rec; want = false; if (was) { try { was.stop(); } catch (e) { finish(true); } } else finish(true); return; }
    stopSpeech();
    speechLive = quietStop;
    want = true; dead = 0; everHeard = false; lastErr = '';
    try {
      begin(); setState(true);
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { if (want && !everHeard) toast('Not hearing anything yet. Check Settings, Siri, Dictation is on, or use the keyboard microphone.'); }, 6000);
      document.addEventListener('visibilitychange', onHide);
    } catch (e) { finish(false); toast('Speech is not available here. The keyboard microphone still works.'); }
  });
  return btn;
}
// toast(message) is your own small message function. Call stopSpeech() whenever a sheet or screen holding a box closes.
```

## Look and accessibility
A big button (48 px tall, full width under the box, a microphone icon and the words), never a tiny icon. A visible listening state that is not colour alone (the words change). Words stay editable. Optional: a "check my words before saving" setting, off by default, for people who want to review dictation.

## Testing
Headless Chromium has no microphone, so stub `window.webkitSpeechRecognition` with a fake class that fires `onstart`, `onresult` (with `results` shaped as `[[{ transcript }]]` plus `isFinal`) and `onend`, and test: words appear, a restart carries on the text, Android-style growing results are not repeated, a second button stops the first, closing the sheet stops it, `not-allowed` shows the message. Then ask the user to try it on their real iPhone and Android phone, because only a real phone runs the real recogniser.
