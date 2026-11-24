# iPhone Duo: how to make this app work on it

For Claude Code working in this repository. Written from what made My Medical Daybook (a vanilla HTML, CSS and JS PWA, also wrapped with Capacitor for TestFlight) work on the iPhone Duo, Apple's foldable. Save this file as `docs/IPHONE-DUO.md` and add one line to this repo's CLAUDE.md: "Every screen must work on the iPhone Duo: follow docs/IPHONE-DUO.md."

## What the Duo is to a web page
- Two screens. Cover (folded): an ordinary tall phone, about 375 to 440 CSS px wide. Inner (unfolded): wide and nearly square. Simulator pictures: cover 1398x2034 px, inner 2007x2853 px. The CSS width depends on Display Zoom, so **plan for anything from 600 to about 950 CSS px** until it has been measured on the device (see Testing).
- Folding or unfolding is a resize, not a reload: `resize` fires, media queries re-run. State must survive it.
- What breaks: layouts stretch edge to edge; phone-only media queries stop matching, leaving a half phone, half desktop middle (headers wrapping onto two rows is the usual sign); a native build made with old Xcode shows letterboxed.
- **Lay out by width, never by device.** No user-agent sniffing, no `isDuo`.

## Rules (all in Daybook today; rules 1 to 6 confirmed by a tester on a real Duo)

1. **Viewport** in every page's head:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
   ```
   Never `maximum-scale=1` or `user-scalable=no` (blocks zoom, fails WCAG).

2. **Cap the content column and centre it.** This does most of the work:
   ```css
   .main { width: 100%; max-width: 640px; margin: 0 auto; }
   ```

3. **Fixed things follow the column** (sheets, dialogs, toasts, bottom bars' content):
   ```css
   @media (min-width: 700px) {
     .sheet-panel { width: min(640px, calc(100% - var(--safe-l) - var(--safe-r))); margin-left: auto; margin-right: auto; }
   }
   ```

4. **Safe areas on all four edges** (the camera is at the side when held sideways):
   ```css
   :root {
     --safe-t: env(safe-area-inset-top, 0px);  --safe-b: env(safe-area-inset-bottom, 0px);
     --safe-l: env(safe-area-inset-left, 0px); --safe-r: env(safe-area-inset-right, 0px);
   }
   .topbar { padding-top: var(--safe-t); padding-left: calc(16px + var(--safe-l)); padding-right: calc(16px + var(--safe-r)); }
   .main   { padding-left: calc(16px + var(--safe-l)); padding-right: calc(16px + var(--safe-r)); }
   .tabs   { padding-bottom: var(--safe-b); padding-left: var(--safe-l); padding-right: var(--safe-r); }
   ```

5. **Grids use `minmax(0, 1fr)`**, never bare `1fr`: `grid-template-columns: repeat(3, minmax(0, 1fr));` or `repeat(auto-fill, minmax(160px, 1fr))`. Grids of expandable cards: `align-items: start` on the grid and `align-self: start` on each card.

6. **Nothing scrolls sideways:**
   ```css
   img, video, canvas { max-width: 100%; height: auto; }
   .long-text { overflow-wrap: anywhere; }
   .flex-row > * { min-width: 0; }
   ```

7. **Any row that must stay on one line (header, nav, button bar) needs a middle layout.** The Daybook website's header wrapped and overflowed at about 920 px: too wide for the phone menu, too narrow for the full one. Fix: three layouts (phone; a short menu from 861 to 1179 px; the full menu from 1180 px) and `white-space: nowrap` on nav links. Check every width from 320 to 1300, not presets. (This one was checked in an emulator only.)

8. **Large text.** iOS does not scale `px` text in a web view by the Text Size setting. Read it and scale:
   ```js
   function applyTextSize() {
     const root = document.documentElement;
     let scale = 1;
     if (window.CSS && CSS.supports('font', '-apple-system-body')) {
       const p = document.createElement('span');
       p.style.cssText = 'font: -apple-system-body; position: absolute; visibility: hidden; -webkit-text-size-adjust: none';
       p.textContent = 'x'; document.body.append(p);
       scale = Math.min(2, Math.max(1, (parseFloat(getComputedStyle(p).fontSize) || 17) / 17));
       p.remove();
     }
     root.style.webkitTextSizeAdjust = Math.round(scale * 100) + '%';
     root.style.setProperty('--ts', String(scale));
     root.classList.toggle('text-big', scale >= 1.25);
     root.classList.toggle('text-huge', scale >= 1.6);
   }
   applyTextSize();
   document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTextSize(); });
   ```
   Then fewer columns at big text: `html.text-big .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }`, `html.text-huge .tiles { grid-template-columns: minmax(0, 1fr); }`. Daybook's real `applyTextSize()` also measures a rendered line afterwards, because some iPhones enlarge text a second time on their own; copy that if testers report text far too big.

9. **Native (Capacitor / TestFlight) builds must use Xcode 27.1 or later.** Older builds run letterboxed on the inner screen and no CSS fixes it. In GitHub Actions:
   ```yaml
   runs-on: xcode-27
   steps:
     - run: sudo xcode-select -s /Applications/Xcode_27.1.app && xcodebuild -version
   ```
   If a tester reports black borders on the Duo, check the build's Xcode before touching CSS.

10. **PWA manifest:** leave `orientation` out (or `any`).

Not used, deliberately: `horizontal-viewport-segments` and `env(viewport-segment-*)`. The inner screen has no hinge to design round and they are untested in Safari.

## Testing
- **On the device first, once:** a page showing `innerWidth x innerHeight` and `devicePixelRatio`, updated on `resize`. Ask the user for the numbers folded and unfolded, at normal and large Text Size, then write them into this file.
- **Headless (Playwright, Chromium):** every width 320, 375, 390, 420, 440, 600, 740, 820, 920, 1024, 1180, 1280; portrait and landscape; text at 1, 1.3 and 1.5. At each: no sideways scroll (`document.documentElement.scrollWidth <= innerWidth`, else list elements whose right edge passes `innerWidth`), controls 44 px or more, no page errors.
- Chromium is not WebKit. Say plainly what was not tried in Safari, and ask the user to check on the real Duo, folded and unfolded, with screenshots.

## Done means
Viewport as rule 1; no sideways scroll at any width; column capped and centred; fixed things no wider than the column; nothing under the camera or corners either way up; one-line rows stay one line from 320 to 1300; large text on the inner screen clean; 44 px targets; fold and unfold with the page open keeps working; native build from Xcode 27.1+; the user has seen it on the real Duo.
