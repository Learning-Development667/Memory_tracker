// Tap to speak. Follows docs/SPEECH-TO-TEXT.md, taken from what works in Daybook.

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const IS_ANDROID_SPEECH = /Android/i.test(navigator.userAgent);
const SPEAK_RESTART_MS = 400, SPEAK_DEAD_MAX = 4;
let speechLive = null;

export const canSpeak = !!SpeechRec;
export function stopSpeech() { if (speechLive) speechLive(); }

const MIC = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

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

export function speakButton(target, toast) { // target: a <textarea> or <input>
  if (!SpeechRec) return null;               // no support: no button
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'speakbtn'; btn.setAttribute('aria-pressed', 'false');
  const words = document.createElement('span');
  btn.innerHTML = MIC; btn.append(words);
  words.textContent = 'Tap to speak';
  let rec = null, want = false, dead = 0, wake = null, everHeard = false, lastErr = '', quietTimer = null;

  const setState = (on) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    words.textContent = on ? 'Listening, tap to stop' + (lastErr ? ' (' + lastErr + ')' : everHeard ? '' : ' (nothing heard yet)') : 'Tap to speak';
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
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { want = false; toast('Allow the microphone for this site to speak your jobs'); }
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
