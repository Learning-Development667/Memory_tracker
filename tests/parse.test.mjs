import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSentence, guessSize, whenStops } from '../js/parse.js';
import { HOUR, MIN } from '../js/order.js';

const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime(); // Tuesday 24 November 2026, 10:00
const ctx = { now: NOW, me: 'a', other: 'b', otherName: 'Sam' };
const p = (s) => parseSentence(s, ctx);
const at = (ms) => { const d = new Date(ms); return [d.getDate(), d.getHours(), d.getMinutes()]; };

test('the whole sentence: job, time and whose list', () => {
  const r = p('Ring the plumber by 3 today, for Sam');
  assert.equal(r.title, 'Ring the plumber');
  assert.deepEqual(at(r.due), [24, 15, 0]);
  assert.equal(r.hasTime, true);
  assert.equal(r.list, 'b');
});

test('a plain job is left alone', () => {
  const r = p('Tidy the snug');
  assert.deepEqual([r.title, r.due, r.list, r.size], ['Tidy the snug', null, null, null]);
});

test('numbers that are not times stay in the job', () => {
  assert.equal(p('Buy 2 pints of milk').title, 'Buy 2 pints of milk');
  assert.equal(p('Buy 2 pints of milk').due, null);
  assert.equal(p('Order 12 screws').due, null);
});

test('within the hour, and in so many minutes', () => {
  assert.equal(p('Put the bins out within the hour').due, NOW + HOUR);
  assert.equal(p('Put the bins out within the hour').title, 'Put the bins out');
  assert.equal(p('Take the cake out in 20 minutes').due, NOW + 20 * MIN);
  assert.equal(p('Check the oven in half an hour').due, NOW + 30 * MIN);
  assert.equal(p('Leave in an hour').due, NOW + HOUR);
});

test('clock times', () => {
  assert.deepEqual(at(p('Pick up the prescription at 4pm').due), [24, 16, 0]);
  assert.deepEqual(at(p('School run at 3.15').due), [24, 15, 15]);
  assert.deepEqual(at(p('Ring the bank at 9:30am tomorrow').due), [25, 9, 30]);
  assert.deepEqual(at(p('Ring the bank by 9').due), [24, 21, 0], 'nine has passed this morning, so nine tonight');
  assert.deepEqual(at(p('Lunch with Jo at noon').due), [24, 12, 0]);
  assert.deepEqual(at(p('Bins out by 8am').due), [25, 8, 0], 'already past, so tomorrow');
});

test('named days', () => {
  let r = p('Post the parcel tomorrow');
  assert.deepEqual([r.title, new Date(r.due).getDate(), r.hasTime], ['Post the parcel', 25, false]);
  r = p('Book the car in by Friday');
  assert.deepEqual([r.title, new Date(r.due).getDate(), r.hasTime], ['Book the car in', 27, false]);
  r = p('Cut the grass this weekend');
  assert.deepEqual([r.title, new Date(r.due).getDate()], ['Cut the grass', 28]);
  r = p('Call the vet tonight');
  assert.deepEqual(at(r.due), [24, 20, 0]);
  r = p('Dentist on 3 December at 2pm');
  assert.deepEqual([new Date(r.due).getMonth(), ...at(r.due)], [11, 3, 14, 0]);
  assert.equal(r.title, 'Dentist');
  r = p('Renew the insurance by 5/1');
  assert.deepEqual([new Date(r.due).getFullYear(), new Date(r.due).getMonth(), new Date(r.due).getDate()], [2027, 0, 5]);
  r = p('Bins out Tuesday');
  assert.equal(new Date(r.due).getDate(), 1, 'Tuesday said on a Tuesday means next week');
});

test('whose list', () => {
  assert.equal(p('Empty the dishwasher for me').list, 'a');
  assert.equal(p('Water the plants for either of us').list, 'either');
  assert.equal(p('Water the plants for either of us').title, 'Water the plants');
  assert.equal(p('Buy a card for Mum').list, null);
  assert.equal(p('Buy a card for Mum').title, 'Buy a card for Mum');
});

test('reminder level and size, when said', () => {
  const r = p('Take the tablets at 8pm and buzz me');
  assert.deepEqual([r.title, r.remind], ['Take the tablets', 'buzzer']);
  assert.equal(p('Sort the drawer, takes 20 minutes').size, 20);
  assert.equal(p('Sort the drawer, takes 20 minutes').title, 'Sort the drawer');
});

test('polite openers are dropped', () => {
  assert.equal(p('remind me to ring the plumber').title, 'Ring the plumber');
});

test('making or fitting something sizeable is a big job', () => {
  for (const t of ['Build a cupboard', 'Finish building the dining room cupboard', 'Make a cupboard for the dining room', 'Put the wardrobe together', 'Fit the new kitchen', 'Build the shed', 'Put up a fence', 'Lay the patio']) assert.equal(guessSize(t), 480, t);
  assert.equal(guessSize('Paint the hall'), 240);
  assert.equal(guessSize('Make the bed'), 15, 'making the bed is quick');
  assert.equal(guessSize('Clean the bathroom'), 30, 'cleaning is not building');
  assert.equal(guessSize('Shut the shed door'), 15);
});

test('size guesses put the cupboard after the snug', () => {
  assert.ok(guessSize('Finish building the dining room cupboard') > guessSize('Tidy the snug'));
  assert.equal(guessSize('Ring the plumber'), 5);
  assert.equal(guessSize('Something with no clue'), 15);
});

test('the When slider stops run from no date to next week, in order', () => {
  const s = whenStops(NOW);
  assert.equal(s[0].due, null);
  for (let i = 2; i < s.length; i++) assert.ok(s[i].due > s[i - 1].due, s[i].label);
  assert.equal(new Date(s[4].due).getDay(), 6);
  assert.equal(new Date(s[5].due).getDay(), 1);
});

test('jobs that take days', () => {
  assert.deepEqual([p('Build mums Christmas present. Probably take me 2 days to get it finished').title, p('Build mums Christmas present. Probably take me 2 days to get it finished').size], ['Build mums Christmas present', 960]);
  assert.equal(p('Build the shed, a three day job').size, 1440);
  assert.equal(p('Clear the garage, takes a week').size, 2400);
  assert.equal(p('Ring the plumber in 2 days').size, null, 'in 2 days is a date, not a length');
});
