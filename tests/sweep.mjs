// Opens the app in headless Chromium at every width in docs/IPHONE-DUO.md and checks:
// no sideways scroll, nothing past the right edge, controls 44 px or more, no page errors.
// Then walks through adding, ordering, ticking, speaking and the buzzer.
// Chromium is not Safari: this does not replace a look on the real phones.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('outside');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

const WIDTHS = [320, 375, 390, 420, 440, 600, 740, 820, 920, 1024, 1180, 1280];
const SCALES = [1, 1.3, 1.5];
const HOUR = 3600000, DAY = 86400000;

function seed(now) {
  let n = 0;
  const job = (title, list, size, extra) => Object.assign({
    id: 's' + (++n), title, list, addedBy: 'a', createdAt: now - DAY + n, updatedAt: now, due: null, hasTime: false, size, sizeFrom: 'guess',
    label: '', remind: 'quiet', repeat: '', steps: [], doneAt: null, doneBy: null, silencedUntil: 0, alertedAt: now,
  }, extra);
  return {
    v: 1,
    profile: { setup: true, me: 'a', names: { a: 'Alex', b: 'Sam' } },
    labels: [{ id: 'l1', name: 'House', colour: 'plum' }, { id: 'l2', name: 'Garden', colour: 'sage' }, { id: 'l3', name: 'Out and about', colour: 'sea' }, { id: 'l4', name: 'Phone and paperwork', colour: 'gold' }],
    settings: { quietOn: true, quietFrom: '22:00', quietTo: '07:00' },
    tasks: [
      job('Ring the plumber about the leak under the kitchen sink', 'a', 5, { due: now + 40 * 60000, hasTime: true, label: 'l4', remind: 'nudge', addedBy: 'b' }),
      job('Collect the prescription', 'a', 15, { due: now - 2 * HOUR, hasTime: true, label: 'l3' }),
      job('Tidy the snug', 'a', 15, { label: 'l1' }),
      job('Put the bins out', 'a', 5, { label: 'l1', repeat: 'week', due: now + 5 * HOUR, hasTime: true }),
      job('Finish building the dining room cupboard', 'a', 480, { label: 'l1', steps: [{ id: 'x1', title: 'Fit the doors', done: false }, { id: 'x2', title: 'Fix it to the wall', done: false }, { id: 'x0', title: 'Build the carcass', done: true }] }),
      job('Mow the lawn', 'a', 30, { label: 'l2' }),
      job('Supercalifragilisticexpialidocious-and-an-unbreakable-word-to-test-wrapping', 'a', 60),
      job('Sort the photographs', 'a', 240, { createdAt: now - 20 * DAY }),
      job('Water the tomatoes', 'a', 5, { doneAt: now - 60000, doneBy: 'a' }),
      job('Book the car in for its MOT', 'b', 5, { due: now + 2 * DAY, hasTime: false }),
      job('Take the parcel back', 'either', 15, { addedBy: 'b' }),
    ],
  };
}

const problems = [];
const note = (where, what) => { problems.push(where + ': ' + what); };

async function check(page, where) {
  const found = await page.evaluate(() => {
    const out = [];
    const vw = innerWidth, doc = document.documentElement;
    if (doc.scrollWidth > vw) out.push('sideways scroll: page is ' + doc.scrollWidth + ' wide, screen is ' + vw);
    const top = document.querySelector('dialog[open]');
    const scope = top || document.body;
    const shown = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    for (const e of scope.querySelectorAll('*')) {
      if (!shown(e) || e.closest('.vh') || e.classList.contains('vh')) continue;
      const r = e.getBoundingClientRect();
      if (r.right > vw + 0.5 || r.left < -0.5) out.push('past the edge: ' + e.tagName.toLowerCase() + '.' + e.className + ' ' + Math.round(r.left) + ' to ' + Math.round(r.right));
    }
    for (const e of scope.querySelectorAll('button, a, select, summary, input, textarea')) {
      if (!shown(e) || e.closest('[hidden]')) continue;
      let box = e;
      if (e.matches('input[type="checkbox"]')) box = e.closest('label') || e;
      if (e.matches('select, input') && e.closest('label.row')) box = e.closest('label.row');
      const r = box.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) out.push('small target (' + Math.round(r.width) + ' x ' + Math.round(r.height) + '): ' + e.tagName.toLowerCase() + '.' + e.className + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + '"');
    }
    return out;
  });
  [...new Set(found)].forEach((f) => note(where, f));
}

const browser = await chromium.launch();
let shots = 0;

async function open(width, height, scale, state) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => note(width + 'x' + height + ' @' + scale, 'page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') note(width + 'x' + height + ' @' + scale, 'console error: ' + m.text()); });
  if (state) await page.addInitScript((s) => { if (!localStorage.getItem('round-tuit-v1')) localStorage.setItem('round-tuit-v1', JSON.stringify(s)); }, state);
  await page.goto(BASE + (scale !== 1 ? '?ts=' + scale : ''));
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

// 1. Every width, upright and sideways, at three text sizes.
for (const width of WIDTHS) {
  for (const height of [844, 400]) {
    for (const scale of SCALES) {
      const where = width + 'x' + height + ' text ' + scale;
      const { context, page } = await open(width, height, scale, seed(Date.now()));
      await check(page, where + ' list');
      await page.click('#addBtn');
      await page.fill('#jt', 'Ring the plumber by 3 today, for Sam');
      await page.locator('details.more > summary').click();
      await check(page, where + ' new job');
      await page.click('.sheethead .iconbtn');
      await page.click('#settingsBtn');
      await check(page, where + ' settings');
      await page.getByRole('button', { name: 'Try the buzzer' }).click();
      await check(page, where + ' buzzer');
      await page.getByRole('button', { name: 'Silence for 10 minutes' }).click();
      await page.locator('.jobbody').nth(4).click();
      await check(page, where + ' change job');
      shots++;
      await context.close();
    }
  }
  const { context, page } = await open(width, 844, 1, null);
  await check(page, width + ' welcome');
  await page.goto(BASE + 'device.html');
  await check(page, width + ' screen check');
  await context.close();
}

// 2. Folding: the page is resized, not reloaded, and a half-written job survives.
{
  const { context, page } = await open(420, 900, 1, seed(Date.now()));
  await page.click('#addBtn');
  await page.fill('#jt', 'Half written job');
  await page.setViewportSize({ width: 820, height: 900 });
  if (await page.inputValue('#jt') !== 'Half written job') note('fold', 'the job being written was lost on unfolding');
  await check(page, 'fold 420 to 820');
  await page.setViewportSize({ width: 420, height: 900 });
  await check(page, 'fold 820 to 420');
  await context.close();
}

// 3. Using it: add by sentence, order, tick, undo, steps, the buzzer.
{
  const expect = (ok, what) => { if (!ok) note('walkthrough', what); };
  const { context, page } = await open(390, 844, 1, null);
  await page.fill('#wMe', 'Alex'); await page.fill('#wThem', 'Sam');
  await page.getByRole('button', { name: 'Start' }).click();
  const add = async (text) => { await page.click('#addBtn'); await page.fill('#jt', text); await page.getByRole('button', { name: 'Save job' }).click(); };
  await add('Finish building the dining room cupboard');
  await add('Tidy the snug');
  await add('Ring the plumber');
  let order = await page.locator('.jt').allTextContents();
  expect(order.join('|') === 'Ring the plumber|Tidy the snug|Finish building the dining room cupboard', 'quick first order was ' + order.join(' | '));

  await page.click('#addBtn');
  await page.fill('#jt', 'Post the parcel within the hour, for Sam');
  expect((await page.locator('.understood').textContent()).includes('Post the parcel'), 'the sentence was not read back');
  expect(await page.inputValue('#jList') === 'b', 'the sentence did not pick the other list');
  expect((await page.locator('#whenOut').textContent()).startsWith('Today'), 'the sentence did not set the time: ' + await page.locator('#whenOut').textContent());
  await page.getByRole('button', { name: 'Save job' }).click();
  order = await page.locator('.jt').allTextContents();
  expect(!order.includes('Post the parcel'), 'a job for the other list showed on mine');
  await page.getByRole('button', { name: /^Sam's/ }).click();
  expect((await page.locator('.jt').allTextContents()).join() === 'Post the parcel', 'the job is not on the other list');
  expect((await page.locator('.meta').first().textContent()).includes('From you'), 'the job does not say who added it');
  await page.getByRole('button', { name: /^Mine/ }).click();

  // The When slider, by keyboard.
  await page.click('#addBtn');
  await page.fill('#jt', 'Slider job');
  await page.focus('#whenRange'); await page.keyboard.press('ArrowRight');
  expect((await page.locator('#whenOut').textContent()).startsWith('Within the hour'), 'the When slider did not move to within the hour');
  await page.getByRole('button', { name: 'Save job' }).click();
  order = await page.locator('.jt').allTextContents();
  expect(order[0] === 'Slider job', 'a job due within the hour is not first: ' + order.join(' | '));

  // Tick and undo.
  await page.getByRole('button', { name: 'Done: Tidy the snug' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.band .jt')].some((e) => e.textContent === 'Tidy the snug'));
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await page.locator('.band .jt').allTextContents()).includes('Tidy the snug'), 'Undo did not put the job back');

  // Short of time.
  await page.locator('.fitrow').click();
  await page.getByRole('button', { name: 'Show jobs that fit' }).click();
  order = await page.locator('.band .jt').allTextContents();
  expect(!order.includes('Finish building the dining room cupboard') && order.includes('Ring the plumber'), 'the 10 minute filter showed ' + order.join(' | '));
  await page.locator('.fitrow').click();
  await page.getByRole('button', { name: 'Show everything' }).click();

  // The buzzer: opens by itself, cannot be escaped, comes back after Silence, stops when ticked.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('round-tuit-v1'));
    const t = s.tasks.find((x) => x.title === 'Ring the plumber');
    t.due = Date.now() - 1000; t.hasTime = true; t.remind = 'buzzer';
    localStorage.setItem('round-tuit-v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('dialog.buzzer[open]');
  expect((await page.locator('#bzTitle').textContent()) === 'Ring the plumber', 'the buzzer did not name the job');
  await page.keyboard.press('Escape');
  expect(await page.locator('dialog.buzzer[open]').count() === 1, 'Escape closed the buzzer');
  await page.getByRole('button', { name: 'Silence for 10 minutes' }).click();
  expect(await page.locator('dialog.buzzer[open]').count() === 0, 'Silence did not close the buzzer');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('round-tuit-v1'));
    s.tasks.find((x) => x.title === 'Ring the plumber').silencedUntil = Date.now() - 1;
    localStorage.setItem('round-tuit-v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('dialog.buzzer[open]');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.waitForTimeout(300);
  expect(await page.locator('dialog.buzzer[open]').count() === 0, 'the buzzer came back after the job was ticked');
  await context.close();
}

// 4. Tap to speak, with a stand-in recogniser (headless Chromium has no microphone).
{
  const expect = (ok, what) => { if (!ok) note('speech', what); };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => note('speech', 'page error: ' + e.message));
  await page.addInitScript((s) => {
    localStorage.setItem('round-tuit-v1', JSON.stringify(s));
    window.fakes = [];
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      constructor() { window.fakes.push(this); this.live = false; }
      start() { this.live = true; setTimeout(() => this.onstart && this.onstart(), 0); }
      stop() { this.live = false; setTimeout(() => this.onend && this.onend(), 0); }
      abort() { this.live = false; setTimeout(() => this.onend && this.onend(), 0); }
      say(text, final) { const r = [{ transcript: text }]; r.isFinal = !!final; this.onresult({ results: [r] }); }
    };
  }, seed(Date.now()));
  await page.goto(BASE);
  await page.click('#micBtn');
  await page.waitForFunction(() => window.fakes.length === 1 && window.fakes[0].live);
  expect((await page.locator('.speakbtn').getAttribute('aria-pressed')) === 'true', 'the button does not show it is listening');
  await page.evaluate(() => window.fakes[0].say('ring the plumber', true));
  expect(await page.inputValue('#jt') === 'ring the plumber', 'spoken words did not reach the box');
  // The phone ends the session by itself: a new one must carry on from the words already there.
  await page.evaluate(() => { const f = window.fakes[0]; f.live = false; f.onend(); });
  await page.waitForFunction(() => window.fakes.length === 2 && window.fakes[1].live);
  await page.evaluate(() => window.fakes[1].say('by 3 today for Sam', true));
  expect(await page.inputValue('#jt') === 'ring the plumber by 3 today for Sam', 'the restart lost the words: ' + await page.inputValue('#jt'));
  expect(await page.inputValue('#jList') === 'b', 'spoken words were not read as a sentence');
  await page.click('.sheethead .iconbtn');
  await page.waitForFunction(() => !window.fakes[1].live);
  expect(await page.evaluate(() => window.fakes.length) === 2, 'closing the sheet did not stop the listening');
  await context.close();
}

await browser.close();
server.close();
const unique = [...new Set(problems)];
console.log(shots + ' width, height and text size combinations checked.');
if (unique.length) { console.log(unique.length + ' problems:\n' + unique.slice(0, 80).join('\n')); process.exit(1); }
console.log('No problems found.');
