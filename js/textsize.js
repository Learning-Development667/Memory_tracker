// iOS does not scale px text in a web view by the phone's Text Size setting. Read it and scale.
// Rule 8 of docs/IPHONE-DUO.md.

export function applyTextSize() {
  const root = document.documentElement;
  let scale = 1;
  if (window.CSS && CSS.supports('font', '-apple-system-body')) {
    const p = document.createElement('span');
    p.style.cssText = 'font: -apple-system-body; position: absolute; visibility: hidden; -webkit-text-size-adjust: none';
    p.textContent = 'x'; document.body.append(p);
    scale = Math.min(2, Math.max(1, (parseFloat(getComputedStyle(p).fontSize) || 17) / 17));
    p.remove();
  }
  // For checking big text where the phone's own setting cannot be reached: ?ts=1.3
  const forced = parseFloat(new URLSearchParams(location.search).get('ts'));
  if (forced >= 1 && forced <= 2) scale = forced;
  root.style.webkitTextSizeAdjust = Math.round(scale * 100) + '%';
  if (forced) root.style.fontSize = Math.round(scale * 100) + '%';
  root.style.setProperty('--ts', String(scale));
  root.classList.toggle('text-big', scale >= 1.25);
  root.classList.toggle('text-huge', scale >= 1.6);
  return scale;
}

export function watchTextSize() {
  applyTextSize();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTextSize(); });
}
