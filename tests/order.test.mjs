import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange, band, isStale, effectiveSize, alertAt, nextRepeat, dueWords, HOUR, DAY, MIN } from '../js/order.js';
import { dueAlerts } from '../js/alarm.js';

const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime(); // Tuesday 24 November 2026, 10:00
let n = 0;
const job = (title, size, due, extra) => Object.assign({ id: 'j' + (++n), title, size, due: due || null, hasTime: !!due, createdAt: NOW - DAY + n, steps: [], remind: 'quiet', doneAt: null }, extra);
const titles = (tasks) => arrange(tasks, NOW).map((r) => r.task.title);

test('quick jobs come before long ones', () => {
  assert.deepEqual(titles([job('Finish building the dining room cupboard', 240), job('Tidy the snug', 15), job('Ring the plumber', 5)]),
    ['Ring the plumber', 'Tidy the snug', 'Finish building the dining room cupboard']);
});

test('a job due within the hour goes to the top', () => {
  const rows = arrange([job('Quick', 5), job('Big but due', 240, NOW + 30 * MIN)], NOW);
  assert.equal(rows[0].task.title, 'Big but due');
  assert.equal(rows[0].band, 0);
});

test('a dated job climbs as its date gets closer', () => {
  const t = job('Post the parcel', 15, NOW + 3 * DAY);
  assert.equal(band(t, NOW), 2);
  assert.equal(band(t, NOW + 3 * DAY - 90 * MIN), 1);
  assert.equal(band(t, NOW + 3 * DAY - 30 * MIN), 0);
});

test('a long job starts climbing earlier than a short one', () => {
  const due = NOW + 2 * DAY - HOUR;
  assert.equal(band(job('Paint the hall', 240, due), NOW), 1);
  assert.equal(band(job('Ring the dentist', 5, due), NOW), 2);
});

test('overdue jobs sit above everything, soonest first', () => {
  assert.deepEqual(titles([job('A', 5), job('Late', 30, NOW - HOUR), job('Later today', 5, NOW + 5 * HOUR), job('Very late', 60, NOW - DAY)]),
    ['Very late', 'Late', 'Later today', 'A']);
});

test('a big job with a next step counts as a short one', () => {
  const big = job('Build the cupboard', 480, null, { steps: [{ id: 's', title: 'Fit the doors', done: false }] });
  assert.equal(effectiveSize(big), 30);
  assert.deepEqual(titles([job('Sort the loft', 60), big]), ['Build the cupboard', 'Sort the loft']);
});

test('done jobs are left out', () => {
  assert.deepEqual(titles([job('Done one', 5, null, { doneAt: NOW }), job('Open one', 15)]), ['Open one']);
});

test('undated jobs go stale after a fortnight, and Keep resets it', () => {
  const t = job('Old one', 15, null, { createdAt: NOW - 15 * DAY });
  assert.equal(isStale(t, NOW), true);
  t.keptAt = NOW - DAY;
  assert.equal(isStale(t, NOW), false);
  assert.equal(isStale(job('Dated', 15, NOW + DAY, { createdAt: NOW - 30 * DAY }), NOW), false);
});

test('a job with a date but no time reminds at 9 am on the day', () => {
  const end = new Date(2026, 10, 26, 23, 59, 59, 999).getTime();
  assert.equal(new Date(alertAt({ due: end, hasTime: false })).getHours(), 9);
  assert.equal(alertAt({ due: NOW, hasTime: true }), NOW);
});

test('repeats move the date on', () => {
  assert.equal(nextRepeat({ due: NOW, repeat: 'week' }), NOW + 7 * DAY);
  assert.equal(new Date(nextRepeat({ due: NOW, repeat: 'month' })).getMonth(), 11);
  assert.equal(nextRepeat({ due: null, repeat: 'week' }), null);
});

test('the words for a date', () => {
  assert.deepEqual(dueWords({ due: NOW + 30 * MIN, hasTime: true }, NOW), { text: 'Due 10:30 am', state: 'soon' });
  assert.equal(dueWords({ due: NOW - HOUR, hasTime: true }, NOW).state, 'late');
  assert.equal(dueWords({ due: NOW + DAY + 5 * HOUR, hasTime: true }, NOW).text, 'Tomorrow 3:00 pm');
  assert.equal(dueWords({ due: NOW + 3 * DAY, hasTime: false }, NOW).text, 'Friday');
});

const SET = { quietOn: true, quietFrom: '22:00', quietTo: '07:00' };
test('quiet reminds once, nudge repeats, buzzer keeps on until done', () => {
  const quiet = job('Q', 5, NOW - MIN), nudge = job('N', 5, NOW - MIN, { remind: 'nudge' }), buzz = job('B', 5, NOW - MIN, { remind: 'buzzer' });
  let a = dueAlerts([quiet, nudge, buzz], NOW, SET);
  assert.deepEqual(a.notify.map((t) => t.title), ['Q', 'N']);
  assert.deepEqual(a.buzz.map((t) => t.title), ['B']);
  quiet.alertedAt = nudge.alertedAt = buzz.alertedAt = NOW;
  a = dueAlerts([quiet, nudge, buzz], NOW + 5 * MIN, SET);
  assert.deepEqual(a.notify, []);
  assert.deepEqual(a.buzz.map((t) => t.title), ['B']);
  a = dueAlerts([quiet, nudge, buzz], NOW + 16 * MIN, SET);
  assert.deepEqual(a.notify.map((t) => t.title), ['N']);
});

test('silence only pauses the buzzer, and ticking stops it', () => {
  const buzz = job('B', 5, NOW - MIN, { remind: 'buzzer', silencedUntil: NOW + 10 * MIN });
  assert.equal(dueAlerts([buzz], NOW + 5 * MIN, SET).buzz.length, 0);
  assert.equal(dueAlerts([buzz], NOW + 11 * MIN, SET).buzz.length, 1);
  buzz.doneAt = NOW + 12 * MIN;
  assert.equal(dueAlerts([buzz], NOW + 30 * MIN, SET).buzz.length, 0);
});

test('a nudge waits through quiet hours', () => {
  const night = new Date(2026, 10, 24, 23, 0, 0).getTime();
  const nudge = job('N', 5, night - HOUR, { remind: 'nudge', alertedAt: night - 30 * MIN });
  assert.equal(dueAlerts([nudge], night, SET).notify.length, 0);
  assert.equal(dueAlerts([nudge], night, { quietOn: false, quietFrom: '22:00', quietTo: '07:00' }).notify.length, 1);
});

test('a planned day lifts a job into Next up, quickest of the rest unchanged', () => {
  const today = new Date(NOW); today.setHours(0, 0, 0, 0);
  const cupboard = job('Build the cupboard', 960, null, { workDays: [today.getTime()] });
  const rows = arrange([job('Tidy the snug', 15), cupboard, job('Paint the hall', 240, NOW + 4 * DAY)], NOW);
  assert.equal(rows[0].task.title, 'Build the cupboard');
  assert.equal(rows[0].band, 1);
  const tomorrowOnly = job('Fit the shelves', 480, null, { workDays: [today.getTime() + DAY] });
  assert.equal(band(tomorrowOnly, NOW), 2, 'a day planned for tomorrow does not lift it today');
  assert.equal(band(tomorrowOnly, NOW + DAY), 1);
});

test('a planned job with no date sorts cleanly beside dated ones', () => {
  const today = new Date(NOW); today.setHours(0, 0, 0, 0);
  const order = titles([job('Due this afternoon', 30, NOW + 4 * HOUR), job('Planned', 960, null, { workDays: [today.getTime()] }), job('Due tonight', 5, NOW + 11 * HOUR)]);
  assert.deepEqual(order, ['Due this afternoon', 'Due tonight', 'Planned'], 'planned for today counts as due by tonight');
});
