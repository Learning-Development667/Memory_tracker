// Sharing between the two phones: sign-in, the shared list, and calls to the bridge.
// The same pattern as Daybook (docs/daybook/1-sign-in-and-shared-data.md):
// Firebase Authentication, Cloud Firestore, and a Cloudflare Worker that alone writes who belongs where.

import { initializeApp } from '../vendor/firebase/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, connectAuthEmulator,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from '../vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, getDoc, onSnapshot, setDoc, deleteDoc,
} from '../vendor/firebase/firebase-firestore.js';
import * as store from './store.js';

const CONFIG = window.ROUND_TUIT_CONFIG || {};

// What the screens need to know. Read with status(), watch with onStatus().
const st = { ready: false, user: null, circle: '', seat: '', members: [], problem: '' };
const watchers = new Set();
const tell = () => watchers.forEach((fn) => fn(st));
export function status() { return st; }
export function onStatus(fn) { watchers.add(fn); return () => watchers.delete(fn); }

let auth = null, db = null;
let stopPointer = null, stopCircle = [];

function plain(e) {
  const code = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'That email and password do not match.';
  if (/email-already-in-use/.test(code)) return 'There is already an account for that email. Sign in instead.';
  if (/weak-password/.test(code)) return 'Use a longer password: 8 characters or more.';
  if (/invalid-email|missing-email/.test(code)) return 'That does not look like an email address.';
  if (/network-request-failed|unavailable/.test(code)) return 'No signal. Try again in a moment.';
  if (/too-many-requests/.test(code)) return 'Too many tries. Wait a few minutes, then try again.';
  return (e && e.message && !code) ? e.message : 'That did not work. Try again in a moment.';
}

function closeCircle() {
  stopCircle.forEach((stop) => stop()); stopCircle = [];
  store.detachRemote();
  st.circle = ''; st.seat = ''; st.members = [];
}

async function openCircle(cid, uid) {
  closeCircle();
  const mine = await getDoc(doc(db, 'circles', cid, 'members', uid));
  if (!mine.exists()) { st.problem = 'This sign-in is not on a shared list any more.'; tell(); return; }
  st.circle = cid; st.seat = mine.data().seat; st.problem = '';
  store.setSeat(st.seat, cid);

  const tasks = collection(db, 'circles', cid, 'tasks'), labels = doc(db, 'circles', cid, 'meta', 'labels');
  const quiet = () => {}; // a write that fails is retried by Firestore when the signal comes back
  store.attachRemote({
    setTask: (t) => setDoc(doc(tasks, t.id), t).catch(quiet),
    deleteTask: (id) => deleteDoc(doc(tasks, id)).catch(quiet),
    setLabels: (list) => setDoc(labels, { labels: list }).catch(quiet),
  });
  const failed = () => { st.problem = 'The shared list could not be read. Check the signal, then open Round TUIT again.'; tell(); };
  stopCircle.push(onSnapshot(collection(db, 'circles', cid, 'members'), (snap) => {
    st.members = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
    const names = {};
    st.members.forEach((m) => { names[m.seat] = m.name; });
    store.setNames(names);
    tell();
  }, failed));
  stopCircle.push(onSnapshot(tasks, (snap) => store.applyRemoteTasks(snap.docs.map((d) => d.data())), failed));
  stopCircle.push(onSnapshot(labels, (snap) => store.applyRemoteLabels(snap.exists() ? (snap.data().labels || []) : []), failed));
  tell();
}

export async function start() {
  const app = initializeApp(CONFIG.firebase);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (CONFIG.emulator) { // local testing only: tests/sharing.mjs
    connectAuthEmulator(auth, CONFIG.emulator.auth, { disableWarnings: true });
    connectFirestoreEmulator(db, CONFIG.emulator.firestoreHost, CONFIG.emulator.firestorePort);
  }
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, (user) => {
    if (stopPointer) { stopPointer(); stopPointer = null; }
    closeCircle();
    st.user = user ? { uid: user.uid, email: user.email } : null;
    if (!user) { st.ready = true; tell(); return; }
    stopPointer = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const cid = snap.exists() ? (snap.data().circle || '') : '';
      st.ready = true;
      if (cid && cid !== st.circle) openCircle(cid, user.uid).catch(() => { st.problem = 'The shared list could not be opened.'; tell(); });
      else if (!cid) { closeCircle(); tell(); }
    }, () => { st.ready = true; st.problem = 'The shared list could not be read.'; tell(); });
    tell();
  });
}

async function bridge(path, payload) {
  const user = auth && auth.currentUser;
  if (!CONFIG.bridge || !user) throw new Error('Sign in first.');
  const idToken = await user.getIdToken();
  let r;
  try {
    r = await fetch(CONFIG.bridge.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify(payload || {}),
    });
  } catch (e) { throw new Error('No signal. Try again in a moment.'); }
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error((data && data.message) || 'Try again in a moment.');
  return data;
}

const tidy = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { throw new Error(plain(e)); } };

export const signIn = tidy((email, password) => signInWithEmailAndPassword(auth, email.trim(), password));
export const signUp = tidy((email, password) => createUserWithEmailAndPassword(auth, email.trim(), password));
export const resetPassword = tidy((email) => sendPasswordResetEmail(auth, email.trim()));
export const signOutNow = tidy(() => signOut(auth));

export const startSharing = (name) => bridge('/circle', { name });
export const invite = () => bridge('/invite');
export const join = (code, name) => bridge('/join', { code, name });
export const rename = (name) => bridge('/name', { name });
